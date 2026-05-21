"""
Drug-Target binding affinity screen on Habana Gaudi.

Real-world use case
-------------------
Given a *target protein* (amino-acid sequence) and a *panel of candidate drugs*
(SMILES strings), predict the binding affinity (pKd) of each drug to the target
using the MAMMAL DTI-BindingDB model. This is the same pattern used in early
drug discovery to triage thousands of candidates before running expensive
biochemical assays.

Output is a ranked table of pKd values (higher = stronger binding).
For context: a pKd >= 7 corresponds to Kd <= 100 nM, which is a typical
"hit" threshold; pKd < 5 (Kd > 10 µM) is essentially non-binding.

Inputs (env vars, all optional)
--------------------------------
TARGET_NAME        Human-readable name for the target            (default: EGFR_kinase_domain)
TARGET_SEQ         Single-letter amino-acid sequence              (default: EGFR kinase domain)
DRUG_LIST          Newline-separated entries of "name=SMILES"     (default: EGFR inhibitor panel)
                   Lines beginning with '#' and blank lines are ignored.
OUTPUT_DIR         Optional directory for ranking.csv/json        (default: unset)

The default demo screens five FDA-approved EGFR-targeting cancer drugs plus
aspirin as a negative control against the EGFR kinase domain. A well-trained
model should rank the EGFR inhibitors well above aspirin.
"""

import csv
import json
import os
import sys
import time
from pathlib import Path

import torch

# ---------------------------------------------------------------------------
# Defaults — EGFR kinase domain + FDA-approved EGFR inhibitor panel
# ---------------------------------------------------------------------------
DEFAULT_TARGET_NAME = "EGFR_kinase_domain"

# Human EGFR (UniProt P00533) intracellular kinase domain, residues 696-1022.
# EGFR is one of the most clinically validated cancer drug targets; mutations
# in this domain drive non-small-cell lung cancer.
DEFAULT_TARGET_SEQ = (
    "GSHMRRRHIVRKRTLRRLLQERELVEPLTPSGEAPNQALLRILKETEFKKIKVLGSGAFGTVYKGLWIPEGEKVKIPVAIKELREATSPKANKEILDEAYVMASVDNPHVCRLLGICLTSTVQLITQLMPFGCLLDYVREHKDNIGSQYLLNWCVQIAKGMNYLEDRRLVHRDLAARNVLVKTPQHVKITDFGLAKLLGAEEKEYHAEGGKVPIKWMALESILHRIYTHQSDVWSYGVTVWELMTFGSKPYDGIPASEISSILEKGERLPQPPICTIDVYMIMVKCWMIDADSRPKFRELIIEFSKMARDPQRYLVIQGDERMHLPSPTDSNFYRALMDEEDMDDVVDADEYLIPQQGFFSSPSTSRTPLLSSLSATSNNSTVACIDRNGLQSCPIKEDSFLQRYSSDPTGALTEDSIDDTFLPVPEYINQSVPKRPAGSVQNPVYHNQPLNPAPSRDPHYQDPHSTAVGNPEYLNTVQPTCVNSTFDSPAHWAQKGSHQISLDNPDYQQDFFPKEAKPNGIFKGSTAENAEYLRVAPQSSEFIGA"
)
# Keep to ~270 aa to stay under tokenizer limit. Default trims long C-terminal tail:
DEFAULT_TARGET_SEQ = DEFAULT_TARGET_SEQ[:270]

DEFAULT_DRUG_LIST = """
# FDA-approved EGFR tyrosine-kinase inhibitors (expected to bind strongly)
Erlotinib=COCCOC1=C(OCCOC)C=C2C(=C1)N=CN=C2NC3=CC=CC(=C3)C#C
Gefitinib=COC1=C(OCCCN2CCOCC2)C=C3C(=C1)N=CN=C3NC4=CC(=C(C=C4)F)Cl
Lapatinib=CS(=O)(=O)CCNCC1=CC=C(O1)C2=CC3=C(C=C2)N=CN=C3NC4=CC(=C(C=C4)OCC5=CC(=CC=C5)F)Cl
Osimertinib=COC1=C(C=C(C=C1NC(=O)C=C)N(C)CCN(C)C)NC2=NC=CC(=N2)C3=CN(C4=CC=CC=C43)C
Afatinib=CN(C)C/C=C/C(=O)NC1=C(C=C2C(=C1)C(=NC=N2)NC3=CC(=C(C=C3)F)Cl)OC4CCOC4
# Negative control — common analgesic, should NOT bind EGFR
Aspirin=CC(=O)OC1=CC=CC=C1C(=O)O
""".strip()

# These are the normalization stats from MAMMAL's DTI-BindingDB fine-tune.
# pKd predictions are de-normalized using them.
NORM_Y_MEAN = 5.79384684128215
NORM_Y_STD = 1.33808027428196


def parse_drug_list(text: str) -> list[tuple[str, str]]:
    drugs: list[tuple[str, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            print(f"  [warn] skipping malformed line (no '='): {line!r}")
            continue
        name, smiles = line.split("=", 1)
        drugs.append((name.strip(), smiles.strip()))
    return drugs


def write_results(
    output_dir: str,
    target_name: str,
    target_length: int,
    ranked_results: list[dict[str, object]],
) -> None:
    outdir = Path(output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "rank",
        "drug",
        "smiles",
        "pkd",
        "kd_approx",
        "interpretation",
        "latency_ms",
    ]
    csv_path = outdir / "ranking.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in ranked_results:
            writer.writerow({field: row[field] for field in fieldnames})

    json_path = outdir / "ranking.json"
    json_path.write_text(
        json.dumps(
            {
                "target_name": target_name,
                "target_length": target_length,
                "candidate_count": len(ranked_results),
                "results": ranked_results,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"\n[Output] wrote {csv_path} and {json_path}")


def main() -> int:
    print("=" * 70)
    print("MAMMAL Drug-Target Binding Affinity Screen  (Habana Gaudi)")
    print("=" * 70)

    target_name = os.environ.get("TARGET_NAME", DEFAULT_TARGET_NAME)
    target_seq = os.environ.get("TARGET_SEQ", DEFAULT_TARGET_SEQ).strip().replace(" ", "").replace("\n", "")
    drug_list_text = os.environ.get("DRUG_LIST", DEFAULT_DRUG_LIST)
    output_dir = os.environ.get("OUTPUT_DIR", "").strip()
    # The dashboard template engine ships multi-line values as literal '\n' inside a
    # single-line YAML env var. Interpret those escapes here so users don't need to
    # worry about it.
    drug_list_text = drug_list_text.replace("\\n", "\n")
    drugs = parse_drug_list(drug_list_text)

    print(f"\nTarget       : {target_name}  ({len(target_seq)} residues)")
    print(f"Drug panel   : {len(drugs)} candidates")
    if not drugs:
        print("ERROR: no drugs to screen.")
        return 2

    # -- HPU sanity probe ---------------------------------------------------
    try:
        import habana_frameworks.torch.core  # noqa: F401
        import habana_frameworks.torch.hpu as hthpu
        n_hpu = hthpu.device_count()
        print(f"\n[HPU]  device_count={n_hpu}  visible={os.environ.get('HABANA_VISIBLE_DEVICES','?')}")
    except Exception as e:  # pragma: no cover
        print(f"[HPU]  habana_frameworks not available: {e}")
        return 3

    # -- Load DTI-fine-tuned MAMMAL ----------------------------------------
    print("\n[Load] Downloading ibm/biomed.omics.bl.sm.ma-ted-458m.dti_bindingdb_pkd ...")
    t0 = time.time()
    from fuse.data.tokenizers.modular_tokenizer.op import ModularTokenizerOp

    # The DTI task module imports a data module that transitively pulls in PyTDC
    # and tiledbsoma — heavy deps only needed for *training*, not inference.
    # Stub them out before importing the task.
    import types as _types
    _stub = _types.ModuleType("mammal.examples.dti_bindingdb_kd.pl_data_module")
    _stub.DtiBindingdbKdDataModule = object  # placeholder; never instantiated here
    sys.modules["mammal.examples.dti_bindingdb_kd.pl_data_module"] = _stub

    from mammal.examples.dti_bindingdb_kd.task import DtiBindingdbKdTask
    from mammal.model import Mammal

    model_id = "ibm/biomed.omics.bl.sm.ma-ted-458m.dti_bindingdb_pkd"
    tokenizer_op = ModularTokenizerOp.from_pretrained(model_id)
    model = Mammal.from_pretrained(model_id)
    model.eval()
    print(f"[Load] model + tokenizer ready in {time.time()-t0:.1f}s")

    device = torch.device("hpu")
    print(f"\n[HPU]  moving model to {device} ...")
    t0 = time.time()
    model = model.to(device)
    print(f"[HPU]  moved in {time.time()-t0:.1f}s")

    # -- Run the screen ----------------------------------------------------
    print(f"\n[Screen] predicting pKd for {len(drugs)} drugs vs {target_name}\n")
    results: list[tuple[str, str, float, float]] = []
    for name, smiles in drugs:
        t0 = time.time()
        sample = DtiBindingdbKdTask.data_preprocessing(
            sample_dict={"target_seq": target_seq, "drug_seq": smiles},
            tokenizer_op=tokenizer_op,
            target_sequence_key="target_seq",
            drug_sequence_key="drug_seq",
            norm_y_mean=None,
            norm_y_std=None,
            device=model.device,
        )
        batch = model.forward_encoder_only([sample])
        batch = DtiBindingdbKdTask.process_model_output(
            batch,
            scalars_preds_processed_key="model.out.dti_bindingdb_kd",
            norm_y_mean=NORM_Y_MEAN,
            norm_y_std=NORM_Y_STD,
        )
        pkd = float(batch["model.out.dti_bindingdb_kd"][0])
        dt = time.time() - t0
        results.append((name, smiles, pkd, dt))
        print(f"  {name:<12s}  pKd = {pkd:6.3f}   ({dt*1000:5.0f} ms)")

    # -- Report ranked --------------------------------------------------
    print("\n" + "=" * 70)
    print(f"Ranked predictions for {target_name}")
    print("=" * 70)
    print(f"{'rank':>4}  {'drug':<14s}  {'pKd':>6s}   {'Kd (approx)':<14s}  interpretation")
    print("-" * 70)
    ranked_results: list[dict[str, object]] = []
    for rank, (name, smiles, pkd, dt) in enumerate(
        sorted(results, key=lambda r: r[2], reverse=True), start=1
    ):
        # Kd ~ 10^-pKd molar; convert to readable
        kd_m = 10 ** (-pkd)
        if kd_m < 1e-9:
            kd_str = f"{kd_m*1e12:.1f} pM"
        elif kd_m < 1e-6:
            kd_str = f"{kd_m*1e9:.1f} nM"
        elif kd_m < 1e-3:
            kd_str = f"{kd_m*1e6:.1f} uM"
        else:
            kd_str = f"{kd_m*1e3:.2f} mM"
        if pkd >= 7:
            note = "strong binder (potential hit)"
        elif pkd >= 6:
            note = "moderate binder"
        elif pkd >= 5:
            note = "weak binder"
        else:
            note = "non-binder"
        ranked_results.append(
            {
                "rank": rank,
                "drug": name,
                "smiles": smiles,
                "pkd": round(pkd, 6),
                "kd_approx": kd_str,
                "interpretation": note,
                "latency_ms": round(dt * 1000, 1),
            }
        )
        print(f"{rank:>4d}  {name:<14s}  {pkd:6.3f}   {kd_str:<14s}  {note}")
    print("=" * 70)
    if output_dir:
        write_results(output_dir, target_name, len(target_seq), ranked_results)
    print("\n[SUCCESS] DTI screen completed on HPU.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
