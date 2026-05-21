# Habana Gaudi base image (matches running cluster: SynapseAI 1.24.0 / PyTorch 2.10)
FROM vault.habana.ai/gaudi-docker/1.24.0/ubuntu24.04/habanalabs/pytorch-installer-2.10.0:latest

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/workspace/.cache/huggingface \
    TRANSFORMERS_CACHE=/workspace/.cache/huggingface \
    PT_HPU_LAZY_MODE=1

WORKDIR /workspace

# Copy repo contents (Dockerfile is in k8s/, build context is repo root)
COPY pyproject.toml README.md LICENSE.txt ./
COPY mammal ./mammal

# The Habana base image ships a Habana-built PyTorch (e.g. 2.10.0a0+gitXXXX).
# Several transitive deps (PyTDC, lightning, etc.) would otherwise downgrade /
# replace torch with a stock CUDA wheel, breaking HPU. Pin the installed torch
# via PIP_CONSTRAINT so pip refuses to touch it.
# Strategy: install mammal + deps without ever letting pip touch torch / torchvision /
# torch_tb_profiler / triton (all shipped, HPU-built, by the Habana base image).
# We do this by:
#  1) Installing fuse-med-ml's deps explicitly (minus torch family).
#  2) Installing everything with --no-deps for the few packages known to drag in torch.
#  3) Installing the rest normally with a PIP_CONSTRAINT pinning torch to the installed
#     git-tagged version (no matching wheel exists on PyPI, so pip cannot reinstall it).
RUN pip install --upgrade pip && \
    pip list --format=freeze 2>/dev/null \
        | grep -iE '^(torch|torchvision|torchaudio|torchdata|torchtext|torch_tb_profiler|triton)==' \
        > /tmp/torch.constraint && \
    echo "=== pip constraints ===" && cat /tmp/torch.constraint && echo "=======================" && \
    # Install the mammal package itself (editable, no deps).
    pip install --no-deps -e ".[examples]" && \
    # Packages that transitively pull in torch/torchvision get --no-deps; we re-add their
    # real runtime deps below.
    pip install --no-deps \
        "fuse-med-ml==0.4.1" \
        "transformers<5.0.0" \
        peft \
        accelerate \
        pytorch-lightning \
        torchmetrics \
        PyTDC \
        vit-pytorch \
        x-transformers && \
    # All remaining deps. PIP_CONSTRAINT pins torch family to the in-image versions, so
    # if any of these still resolved torch, pip would error rather than silently downgrade.
    PIP_CONSTRAINT=/tmp/torch.constraint pip install \
        "tensorflow>=2.17" \
        "transformers<5.0.0" \
        tabulate \
        clearml \
        hydra-core \
        pytest \
        anndata \
        click \
        scikit-learn \
        pandas \
        numpy \
        h5py \
        hdf5plugin \
        scipy \
        tqdm \
        huggingface_hub \
        tokenizers \
        safetensors \
        einops \
        omegaconf \
        rdkit \
        pyyaml \
        matplotlib \
        nibabel \
        paramiko \
        pycocotools \
        statsmodels \
        tables \
        wget \
        ipywidgets \
        seaborn \
        jsonargparse \
        deepdiff \
        lifelines \
        choix \
        tensorboard \
        psutil \
        ipython \
        ipykernel \
        termcolor \
        fuzzywuzzy \
        python-Levenshtein && \
    python -c "import torch; v=torch.__version__; assert 'a0+git' in v or '+hpu' in v or 'gaudi' in v.lower(), f'Habana torch was replaced: {v}'; print('torch OK:', v)" && \
    python -c "import habana_frameworks.torch.core; print('habana_frameworks OK')" && \
    python -c "from mammal.model import Mammal; print('mammal import OK')"

# POC entrypoint scripts
COPY k8s/run_poc.py     /workspace/run_poc.py
COPY k8s/dti_screen.py  /workspace/dti_screen.py

CMD ["python", "/workspace/run_poc.py"]
