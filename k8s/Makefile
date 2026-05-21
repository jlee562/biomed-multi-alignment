IMAGE ?= dcx-registry.rc.asu.edu/mammal-poc:latest
NS    ?= mammal-poc
REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)

.PHONY: build push deploy logs status clean rebuild all

all: build push deploy logs

build:
	cd $(REPO_ROOT) && podman build --tls-verify=false -f k8s/Dockerfile -t $(IMAGE) .

push:
	podman push --tls-verify=false $(IMAGE)

deploy:
	kubectl -n $(NS) delete job mammal-poc-inference --ignore-not-found
	kubectl apply -f $(REPO_ROOT)/k8s/job.yaml

status:
	kubectl -n $(NS) get pod -l job-name=mammal-poc-inference

logs:
	@kubectl -n $(NS) wait --for=condition=complete --timeout=600s job/mammal-poc-inference 2>/dev/null \
		|| kubectl -n $(NS) wait --for=condition=failed --timeout=10s job/mammal-poc-inference 2>/dev/null || true
	kubectl -n $(NS) logs job/mammal-poc-inference | grep -vE '(^[ 0-9,]+$$|OrderedVocab)'

clean:
	kubectl delete -f $(REPO_ROOT)/k8s/job.yaml --ignore-not-found

rebuild: build push deploy logs

# --- Drug-Target binding affinity screen (real drug-discovery example) ---
# Runs the same image with a different entrypoint script.
DTI_JOB ?= mammal-dti-egfr

dti-deploy:
	kubectl -n $(NS) delete job $(DTI_JOB) --ignore-not-found
	@TMP=$$(mktemp); \
	 sed -e 's|run_poc.py|dti_screen.py|' -e 's|name: mammal-poc-inference|name: $(DTI_JOB)|' $(REPO_ROOT)/k8s/job.yaml > $$TMP; \
	 kubectl apply -f $$TMP; \
	 rm $$TMP

dti-logs:
	@kubectl -n $(NS) wait --for=condition=complete --timeout=600s job/$(DTI_JOB) 2>/dev/null \
		|| kubectl -n $(NS) wait --for=condition=failed --timeout=10s job/$(DTI_JOB) 2>/dev/null || true
	kubectl -n $(NS) logs job/$(DTI_JOB) | grep -vE '(^[ 0-9,]+$$|OrderedVocab)'

dti: build push dti-deploy dti-logs
