import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TemplateVariable {
  key: string;
  label: string;
  default: string;
  hint?: string;
}

export type TemplateCategory = "serving" | "web" | "utility";

export interface K8sTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string; // lucide icon name
  filename: string;
  variables: TemplateVariable[];
}

// ---------------------------------------------------------------------------
// Template Registry — one entry per YAML file in data/k8s-templates/
// ---------------------------------------------------------------------------
export const TEMPLATES: K8sTemplate[] = [
  {
    id: "fastfold",
    name: "FastFold (AlphaFold) Protein Folding",
    description:
      "Predict 3D protein structure from an amino acid sequence using AlphaFold on Gaudi HPU. Automatically downloads model parameters on first run. Paste your FASTA sequence and go.",
    category: "serving",
    icon: "Dna",
    filename: "fastfold.yaml",
    variables: [
      {
        key: "JOB_NAME",
        label: "Job Name",
        default: "fastfold-predict",
        hint: "Lowercase alphanumeric name for the K8s Job and PVC",
      },
      {
        key: "FASTA_SEQUENCE",
        label: "FASTA Sequence",
        default:
          ">query\\nMKTAYIAKQRQISFVKSHFSRQDILDLWIYHTQGYFPDWQNYTAGICKIPVAIAVELGATIGD",
        hint: "Paste your full FASTA input (header line starting with > followed by sequence, separated by \\n). The default is a short test protein.",
      },
      {
        key: "MODEL_NAME",
        label: "AlphaFold Model",
        default: "model_1",
        hint: "model_1 through model_5, or model_1_ptm through model_5_ptm",
      },
      {
        key: "MODEL_PRESET",
        label: "Model Preset",
        default: "monomer",
        hint: "monomer for single chains, multimer for protein complexes",
      },
      {
        key: "DB_PRESET",
        label: "Database Preset",
        default: "full_dbs",
        hint: "full_dbs or reduced_dbs (reduced is faster but less accurate)",
      },
      {
        key: "HPU_COUNT",
        label: "HPU Count",
        default: "1",
        hint: "Number of Gaudi HPUs (1 for most proteins, 4 or 8 for very large ones)",
      },
      {
        key: "CPU",
        label: "CPU",
        default: "8",
        hint: "CPU cores for MSA alignment and data processing",
      },
      {
        key: "MEMORY",
        label: "Memory",
        default: "64Gi",
        hint: "Memory allocation (64Gi is sufficient for most proteins)",
      },
      {
        key: "STORAGE_SIZE",
        label: "Storage Size",
        default: "20Gi",
        hint: "Longhorn PVC size. 10Gi for params + outputs. Increase to 2500Gi if you plan to store full AlphaFold databases.",
      },
    ],
  },
  {
    id: "mammal-dti-screen",
    name: "MAMMAL Drug-Target Binding Screen",
    description:
      "Real drug-discovery workflow: predict binding affinity (pKd) of a panel of candidate drugs (SMILES) against a target protein (amino-acid sequence) using IBM's MAMMAL foundation model fine-tuned on BindingDB. No external input files are required for this template; the dashboard form supplies the target and drug panel directly, and the job can emit CSV/JSON results for download. Completes in roughly 1 minute (model download + screen).",
    category: "serving",
    icon: "FlaskConical",
    filename: "mammal-dti-screen.yaml",
    variables: [
      {
        key: "JOB_NAME",
        label: "Job Name",
        default: "mammal-dti-egfr",
        hint: "Lowercase alphanumeric name for the K8s Job",
      },
      {
        key: "TARGET_NAME",
        label: "Target Name",
        default: "EGFR_kinase_domain",
        hint: "Human-readable label shown in the output (no spaces).",
      },
      {
        key: "TARGET_SEQ",
        label: "Target Protein Sequence",
        default:
          "GSHMRRRHIVRKRTLRRLLQERELVEPLTPSGEAPNQALLRILKETEFKKIKVLGSGAFGTVYKGLWIPEGEKVKIPVAIKELREATSPKANKEILDEAYVMASVDNPHVCRLLGICLTSTVQLITQLMPFGCLLDYVREHKDNIGSQYLLNWCVQIAKGMNYLEDRRLVHRDLAARNVLVKTPQHVKITDFGLAKLLGAEEKEYHAEGGKVPIKWMALESILHRIYTHQSDVWSYGVTVWELMTFGSKPYDGIPASEISSILEKGERLPQPPICTI",
        hint: "Single-letter amino-acid sequence (no FASTA header). Default is human EGFR kinase domain (UniProt P00533, residues 696-965), a clinically validated cancer target. Max ~1250 residues.",
      },
      {
        key: "DRUG_LIST",
        label: "Drug Panel",
        default:
          "Erlotinib=COCCOC1=C(OCCOC)C=C2C(=C1)N=CN=C2NC3=CC=CC(=C3)C#C\\nGefitinib=COC1=C(OCCCN2CCOCC2)C=C3C(=C1)N=CN=C3NC4=CC(=C(C=C4)F)Cl\\nLapatinib=CS(=O)(=O)CCNCC1=CC=C(O1)C2=CC3=C(C=C2)N=CN=C3NC4=CC(=C(C=C4)OCC5=CC(=CC=C5)F)Cl\\nOsimertinib=COC1=C(C=C(C=C1NC(=O)C=C)N(C)CCN(C)C)NC2=NC=CC(=N2)C3=CN(C4=CC=CC=C43)C\\nAfatinib=CN(C)C/C=C/C(=O)NC1=C(C=C2C(=C1)C(=NC=N2)NC3=CC(=C(C=C4)F)Cl)OC4CCOC4\\nAspirin=CC(=O)OC1=CC=CC=C1C(=O)O",
        hint: "Newline-separated 'name=SMILES' entries (use literal \\n between drugs in the dashboard input field). Lines beginning with # are treated as comments. Default is five FDA-approved EGFR inhibitors plus aspirin as a negative control.",
      },
      {
        key: "CPU",
        label: "CPU",
        default: "4",
        hint: "CPU cores (request = limit). Inference is HPU-bound; 4 is plenty.",
      },
      {
        key: "MEMORY",
        label: "Memory",
        default: "32Gi",
        hint: "Memory (request = limit). 32Gi is plenty for the 458M-parameter model.",
      },
    ],
  },
  {
    id: "vllm-gaudi",
    name: "vLLM Gaudi Inference",
    description:
      "Run a vLLM inference server on Gaudi HPUs. Based on the production-tested ASU registry image with all Gaudi env vars pre-configured.",
    category: "serving",
    icon: "Cpu",
    filename: "vllm-gaudi.yaml",
    variables: [
      {
        key: "JOB_NAME",
        label: "Job Name",
        default: "vllm-qwen3-30b-thinking",
        hint: "Lowercase alphanumeric name for the K8s Job",
      },
      {
        key: "MODEL_NAME",
        label: "Model Name",
        default: "Qwen/Qwen3-30B-A3B-Thinking-2507",
        hint: "HuggingFace model ID (e.g., Qwen/Qwen3-30B-A3B-Thinking-2507). Gaudi nodes perform best with officially supported models, though others may also work — see https://docs.vllm.ai/projects/gaudi/en/latest/getting_started/validated_models.html",
      },
      {
        key: "SERVED_MODEL_NAME",
        label: "Served Model Name",
        default: "qwen3-30b-a3b-thinking",
        hint: "Alias exposed by the /v1/models endpoint",
      },
      {
        key: "TENSOR_PARALLEL_SIZE",
        label: "Tensor Parallel Size",
        default: "1",
        hint: "Must match HPU Count (1, 2, 4, or 8)",
      },
      {
        key: "GPU_COUNT",
        label: "HPU Count",
        default: "1",
        hint: "Number of Gaudi HPUs (habana.ai/gaudi)",
      },
      {
        key: "MAX_MODEL_LEN",
        label: "Max Model Length",
        default: "16384",
        hint: "Maximum sequence length in tokens",
      },
      {
        key: "MAX_NUM_SEQS",
        label: "Max Concurrent Sequences",
        default: "2",
        hint: "Maximum number of sequences processed in parallel",
      },
      {
        key: "CPU",
        label: "CPU",
        default: "8",
        hint: "CPU cores (request = limit)",
      },
      {
        key: "MEMORY",
        label: "Memory",
        default: "64Gi",
        hint: "Memory (request = limit, e.g., 64Gi)",
      },
    ],
  },
  {
    id: "hello-world",
    name: "Hello World",
    description:
      "Simple nginx Deployment + Service. A quick test to verify your namespace and kubectl access.",
    category: "web",
    icon: "Globe",
    filename: "hello-world.yaml",
    variables: [
      {
        key: "APP_NAME",
        label: "App Name",
        default: "hello-world",
        hint: "Lowercase name for the deployment and service",
      },
      {
        key: "IMAGE",
        label: "Container Image",
        default: "nginx:latest",
        hint: "Docker image to run (e.g., nginx:latest, httpd:alpine)",
      },
      {
        key: "REPLICAS",
        label: "Replicas",
        default: "1",
        hint: "Number of pod replicas",
      },
      {
        key: "PORT",
        label: "Service Port",
        default: "80",
        hint: "Port exposed by the ClusterIP service",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEMPLATES_DIR = path.join(process.cwd(), "data", "k8s-templates");

/** Return template metadata (without loading YAML content) */
export function getTemplateList(): Omit<K8sTemplate, "filename">[] {
  return TEMPLATES.map(({ filename: _filename, ...rest }) => rest);
}

/** Load the raw YAML string for a specific template */
export function getTemplateYaml(templateId: string): string | null {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;

  const filePath = path.join(TEMPLATES_DIR, tpl.filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    console.error(`Failed to read template file: ${filePath}`);
    return null;
  }
}

/** Replace {{KEY}} placeholders in YAML with user-provided values */
export function renderTemplate(
  yaml: string,
  variables: Record<string, string>
): string {
  let rendered = yaml;
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{KEY}} (with optional whitespace inside braces)
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    rendered = rendered.replace(pattern, value);
  }
  return rendered;
}

/** Check if there are any unresolved {{VARIABLE}} placeholders remaining */
export function getUnresolvedVariables(yaml: string): string[] {
  const matches = yaml.match(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/[{}\s]/g, "")))];
}
