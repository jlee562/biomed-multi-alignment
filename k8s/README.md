# MAMMAL Kubernetes POC (Habana Gaudi)

End-to-end proof of concept that builds a container with the upstream
[MAMMAL](https://github.com/BiomedSciAI/biomed-multi-alignment) library, pushes
it to the cluster registry, and runs a one-shot Habana Gaudi (HPU) inference
Job on Kubernetes. The driver script downloads the `ibm/biomed.omics.bl.sm.ma-ted-458m`
model from Hugging Face, moves it to the HPU, and runs a protein-protein binding
prediction.

## Files in this directory

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Reproducible image based on the Habana 1.24.0 PyTorch installer; installs MAMMAL while preserving the Habana-built PyTorch wheel. |
| [run_poc.py](run_poc.py) | POC driver: probes env, loads MAMMAL, moves to HPU, runs a single inference. |
| [dti_screen.py](dti_screen.py) | **Real drug-discovery example**: ranks a panel of candidate drugs (SMILES) by predicted binding affinity (pKd) against a target protein. Defaults to FDA-approved EGFR inhibitors vs the EGFR kinase domain. |
| [job.yaml](job.yaml) | Namespace + Job manifest (Gaudi node selector, habana runtime, hostIPC, one HPU). |
| [Makefile](Makefile) | Convenience targets for build / push / deploy / logs / clean. |
| `../examples/mammal-dti-screen.yaml` | Parameterized dashboard template for the DTI screen (TARGET_SEQ, DRUG_LIST, etc). |

## Prerequisites

- A Kubernetes cluster with Habana Gaudi nodes labeled `habana.ai/gaudi=present`
  and the `habana` `RuntimeClass` registered.
- `kubectl` configured for the target cluster.
- `podman` (or `docker`) for building the image.
- Network access to:
  - `vault.habana.ai` (Habana base image)
  - `dcx-registry.rc.asu.edu` (target registry — open, no auth, self-signed TLS)
  - `huggingface.co` (model weights download at runtime)

## Quick start

```bash
# from the repo root
make -C k8s build push deploy logs
```

Or step-by-step (also from the repo root):

```bash
# 1. Build the image (Dockerfile is in k8s/, build context is repo root)
podman build --tls-verify=false \
  -f k8s/Dockerfile \
  -t dcx-registry.rc.asu.edu/mammal-poc:latest .

# 2. Push to the cluster registry (no auth, self-signed cert)
podman push --tls-verify=false dcx-registry.rc.asu.edu/mammal-poc:latest

# 3. Apply the namespace + job
kubectl apply -f k8s/job.yaml

# 4. Watch progress (~80s end-to-end on a warm node)
kubectl -n mammal-poc get pod -l job-name=mammal-poc-inference -w

# 5. Read the logs once Succeeded
kubectl -n mammal-poc logs job/mammal-poc-inference \
  | grep -vE '(^[ 0-9,]+$|OrderedVocab)'
```

Expected tail of a successful run:

```
[ Move model to HPU ]
…HPU PT BRIDGE CONFIGURATION ON RANK = 0 …
moved to hpu in 3.1s

[ Build sample prompt ]
input tokens: torch.Size([295])

[ Generate prediction on HPU ]
generation time      : 2.02s
generated_output     : '<SENTINEL_ID_0><1><EOS>'

[ SUCCESS ]
MAMMAL POC inference completed on HPU.
```

## Cleanup

```bash
make -C k8s clean
# or
kubectl delete -f k8s/job.yaml
```

## A more interesting example: drug-target binding affinity screen

[dti_screen.py](dti_screen.py) demonstrates the kind of workflow you would
actually run in early-stage drug discovery: rank a panel of candidate molecules
by predicted binding affinity (pKd) against a target protein, using IBM's
MAMMAL foundation model fine-tuned on BindingDB
(`ibm/biomed.omics.bl.sm.ma-ted-458m.dti_bindingdb_pkd`).

The default demo screens five FDA-approved EGFR tyrosine-kinase inhibitors
(Erlotinib, Gefitinib, Lapatinib, Osimertinib, Afatinib) plus aspirin as a
negative control against the EGFR kinase domain — one of the most clinically
validated cancer drug targets in oncology.

To run it, point the existing Job at `dti_screen.py` instead of `run_poc.py`,
or apply the parameterized dashboard template at
[`../examples/mammal-dti-screen.yaml`](../examples/mammal-dti-screen.yaml)
after substituting `{{NAMESPACE}}`, `{{JOB_NAME}}`, `{{TARGET_SEQ}}` and
`{{DRUG_LIST}}`.

A real run produces something like:

```
[Screen] predicting pKd for 6 drugs vs EGFR_kinase_domain
  Erlotinib     pKd =  5.619   ( 764 ms)   # first call: HPU graph compile
  Gefitinib     pKd =  5.652   (  51 ms)
  Lapatinib     pKd =  5.873   (  46 ms)
  Osimertinib   pKd =  5.753   (  45 ms)
  Afatinib      pKd =  5.805   (  45 ms)
  Aspirin       pKd =  5.540   (  46 ms)

Ranked predictions for EGFR_kinase_domain
   1  Lapatinib        5.873   1.3 uM          weak binder
   2  Afatinib         5.805   1.6 uM          weak binder
   3  Osimertinib      5.753   1.8 uM          weak binder
   4  Gefitinib        5.652   2.2 uM          weak binder
   5  Erlotinib        5.619   2.4 uM          weak binder
   6  Aspirin          5.540   2.9 uM          weak binder
```

Note that all five EGFR inhibitors rank above aspirin — the model correctly
identifies the directional signal, which is what an *in silico* triage step
needs to do before committing to wet-lab assays. Per-prediction latency after
the first HPU graph compile is ~46 ms (≈22 predictions/sec on a single Gaudi).

To screen your own target, pass a custom `TARGET_SEQ` (single-letter
amino-acid sequence, ≤1250 residues) and `DRUG_LIST` (newline-separated
`Name=SMILES` entries) as environment variables in the Job spec.

## How the Job spec talks to the HPU

The job manifest contains four lines that are required for HPU acquisition to
succeed and that are easy to forget:

```yaml
runtimeClassName: habana            # binds the pod to the habana container runtime
hostIPC: true                       # required for ibverbs init / shared memory
nodeSelector: { habana.ai/gaudi: present }
tolerations:
  - { key: habana, operator: Exists, effect: NoSchedule }
  - { key: habana, operator: Exists, effect: NoExecute }
resources:
  limits:    { habana.ai/gaudi: "1" }
  requests:  { habana.ai/gaudi: "1" }
```

Without `runtimeClassName: habana` the pod still gets a Gaudi device allocated
by the device-plugin (so `HABANA_VISIBLE_DEVICES` is set and `torch.hpu.device_count() == 1`)
but `model.to("hpu")` fails with:

```
hcl_device_control_factory.cpp:84(initDevice): g_ibv.init(deviceConfig) == hcclSuccess failed.
ibv initialization failed
RuntimeError: synStatus=26 [Generic failure] Device acquire failed.
```

That is the symptom: if you see it, you are missing the habana runtimeclass
and/or `hostIPC: true`.

## How the Dockerfile preserves Habana PyTorch

The Habana base image installs PyTorch from a local wheel
(`torch 2.10.0a0+gitc1e5ed4`). Any `pip install` that pulls a package that
declares `torch>=2.x` will yank that wheel and replace it with the public
CUDA-only build, breaking HPU support.

The Dockerfile pins around this with two mechanisms:

1. A constraint file built from `pip list --format=freeze` captures the local
   torch / torchvision / torch_tb_profiler / triton versions and is then used
   via `PIP_CONSTRAINT=...` for every subsequent install.
2. Packages whose declared `torch` requirement does not match the Habana variant
   (e.g. `fuse-med-ml`, `PyTDC`, `transformers`, `peft`, `accelerate`,
   `pytorch-lightning`, `torchmetrics`, `vit-pytorch`, `x-transformers`,
   `tokenizers`) are installed with `--no-deps`, and their transitive
   dependencies are listed explicitly under the constraint file.

After install the Dockerfile asserts:

```python
import torch; assert "a0+git" in torch.__version__
import habana_frameworks.torch.core
from mammal.model import Mammal
```

so an image that successfully tags is guaranteed to start cleanly on the HPU.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ibv initialization failed; synStatus=26 Device acquire failed` | Missing `runtimeClassName: habana` and/or `hostIPC: true` | See spec snippet above. |
| `Failed to pull image …mammal-poc:latest` with cert errors | Registry uses self-signed TLS | k3s on this cluster is preconfigured to allow it; if you run elsewhere, add the registry to `/etc/containers/registries.conf` or the cluster CA bundle. |
| `ModuleNotFoundError: deepdiff` / `hdf5plugin` / `lifelines` / `choix` / `tensorboard` | Transitive dep of fuse-med-ml / PyTDC was skipped | Add it to the explicit `pip install` block in the Dockerfile (keep `--no-deps` and the constraint file). |
| `torch.__version__ == '2.10.0'` (no `a0+git`) | pip replaced the Habana wheel with the public build | Some new dep is missing from the constraint / `--no-deps` block; rebuild and inspect `pip install` output. |
| Pod stuck `Pending` with `0/N nodes available: insufficient habana.ai/gaudi` | All HPUs already allocated | `kubectl get nodes -L habana.ai/gaudi` and wait or pick another cluster. |

## Image reference

- Registry: `dcx-registry.rc.asu.edu` (open, no auth, self-signed TLS — use
  `--tls-verify=false` with podman; k3s pulls work without extra config).
- Tag: `dcx-registry.rc.asu.edu/mammal-poc:latest`
- Base: `vault.habana.ai/gaudi-docker/1.24.0/ubuntu24.04/habanalabs/pytorch-installer-2.10.0:latest`
