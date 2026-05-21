"""POC inference script for MAMMAL on Habana Gaudi (HPU).

Loads ibm/biomed.omics.bl.sm.ma-ted-458m from HuggingFace, runs the
protein-protein binding-affinity example, and prints the prediction.
Exit code 0 == success.
"""

from __future__ import annotations

import os
import sys
import time

print("=" * 70, flush=True)
print("MAMMAL Kubernetes POC — Habana Gaudi inference", flush=True)
print("=" * 70, flush=True)


def _section(title: str) -> None:
    print(f"\n[ {title} ]", flush=True)


_section("Environment")
print(f"python    : {sys.version.split()[0]}", flush=True)
print(f"HABANA_VISIBLE_DEVICES = {os.environ.get('HABANA_VISIBLE_DEVICES', '<unset>')}", flush=True)
print(f"PT_HPU_LAZY_MODE       = {os.environ.get('PT_HPU_LAZY_MODE', '<unset>')}", flush=True)

_section("Probe HPU")
import torch  # noqa: E402

try:
    import habana_frameworks.torch.core as htcore  # noqa: F401
    import habana_frameworks.torch.hpu as hthpu

    hpu_count = hthpu.device_count()
    print(f"torch                 : {torch.__version__}", flush=True)
    print(f"habana_frameworks     : importable", flush=True)
    print(f"hpu device_count      : {hpu_count}", flush=True)
    if hpu_count < 1:
        print("ERROR: no HPU available to this container", file=sys.stderr, flush=True)
        sys.exit(2)
    device = torch.device("hpu")
except Exception as e:
    print(f"ERROR initializing HPU: {e}", file=sys.stderr, flush=True)
    sys.exit(3)

_section("Load model + tokenizer (downloads from HuggingFace on first run)")
t0 = time.time()
from fuse.data.tokenizers.modular_tokenizer.op import ModularTokenizerOp  # noqa: E402

from mammal.keys import (  # noqa: E402
    CLS_PRED,
    ENCODER_INPUTS_ATTENTION_MASK,
    ENCODER_INPUTS_STR,
    ENCODER_INPUTS_TOKENS,
)
from mammal.model import Mammal  # noqa: E402

MODEL_ID = "ibm/biomed.omics.bl.sm.ma-ted-458m"
model = Mammal.from_pretrained(MODEL_ID)
model.eval()
tokenizer_op = ModularTokenizerOp.from_pretrained(MODEL_ID)
print(f"loaded in {time.time() - t0:.1f}s", flush=True)

_section("Move model to HPU")
t0 = time.time()
model = model.to(device)
print(f"moved to {device} in {time.time() - t0:.1f}s", flush=True)

_section("Build sample prompt")
protein_calmodulin = (
    "MADQLTEEQIAEFKEAFSLFDKDGDGTITTKELGTVMRSLGQNPTEAELQDMISELDQDGFIDKEDLHDGDGKISF"
    "EEFLNLVNKEMTADVDGDGQVNYEEFVTMMTSK"
)
protein_calcineurin = (
    "MSSKLLLAGLDIERVLAEKNFYKEWDTWIIEAMNVGDEEVDRIKEFKEDEIFEEAKTLGTAEMQEYKKQKLEEAIE"
    "GAFDIFDKDGNGYISAAELRHVMTNLGEKLTDEEVDEMIRQMWDQNGDWDRIKELKFGEIKKLSAKDTRGTIFIKV"
    "FENLGTGVDSEYEDVSKYMLKHQ"
)
sample_dict = {
    ENCODER_INPUTS_STR: (
        "<@TOKENIZER-TYPE=AA><BINDING_AFFINITY_CLASS><SENTINEL_ID_0>"
        "<MOLECULAR_ENTITY><MOLECULAR_ENTITY_GENERAL_PROTEIN>"
        f"<SEQUENCE_NATURAL_START>{protein_calmodulin}<SEQUENCE_NATURAL_END>"
        "<MOLECULAR_ENTITY><MOLECULAR_ENTITY_GENERAL_PROTEIN>"
        f"<SEQUENCE_NATURAL_START>{protein_calcineurin}<SEQUENCE_NATURAL_END><EOS>"
    )
}
tokenizer_op(
    sample_dict=sample_dict,
    key_in=ENCODER_INPUTS_STR,
    key_out_tokens_ids=ENCODER_INPUTS_TOKENS,
    key_out_attention_mask=ENCODER_INPUTS_ATTENTION_MASK,
)
sample_dict[ENCODER_INPUTS_TOKENS] = torch.tensor(
    sample_dict[ENCODER_INPUTS_TOKENS], device=device
)
sample_dict[ENCODER_INPUTS_ATTENTION_MASK] = torch.tensor(
    sample_dict[ENCODER_INPUTS_ATTENTION_MASK], device=device
)
print(f"input tokens: {sample_dict[ENCODER_INPUTS_TOKENS].shape}", flush=True)

_section("Generate prediction on HPU")
t0 = time.time()
with torch.no_grad():
    batch_dict = model.generate(
        [sample_dict],
        output_scores=True,
        return_dict_in_generate=True,
        max_new_tokens=5,
    )
elapsed = time.time() - t0
generated_output = tokenizer_op._tokenizer.decode(batch_dict[CLS_PRED][0])
print(f"generation time      : {elapsed:.2f}s", flush=True)
print(f"generated_output     : {generated_output!r}", flush=True)

_section("SUCCESS")
print("MAMMAL POC inference completed on HPU.", flush=True)
sys.exit(0)
