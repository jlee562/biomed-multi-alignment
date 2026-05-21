"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LayoutGrid, FileCode2 } from "lucide-react";
import K8sYamlEditor from "./k8s-yaml-editor";
import K8sTemplatePicker from "./k8s-template-picker";

// ---------------------------------------------------------------------------
// Deploy Section — Quick Launch cards
// ---------------------------------------------------------------------------
export default function K8sDeploySection() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [showYamlEditor, setShowYamlEditor] = useState(false);

  return (
    <>
      <div className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Quick Launch
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-4 p-5 rounded-xl border border-border/40 bg-card/50 hover:bg-card hover:border-border transition-all text-left group"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-muted transition-colors shrink-0">
              <LayoutGrid className="h-5 w-5 text-foreground/70" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Browse Templates
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Launch from a pre-configured template library
              </p>
            </div>
          </button>

          <button
            onClick={() => setShowYamlEditor(true)}
            className="flex items-center gap-4 p-5 rounded-xl border border-border/40 bg-card/50 hover:bg-card hover:border-border transition-all text-left group"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-muted transition-colors shrink-0">
              <FileCode2 className="h-5 w-5 text-foreground/70" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Advanced YAML
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste or upload custom YAML
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Template picker dialog */}
      <K8sTemplatePicker
        open={showTemplates}
        onOpenChange={setShowTemplates}
        onDeployed={() => setShowTemplates(false)}
      />

      {/* Custom YAML editor dialog */}
      <Dialog open={showYamlEditor} onOpenChange={setShowYamlEditor}>
        <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5 text-primary" />
              Deploy Custom YAML
            </DialogTitle>
            <DialogDescription>
              Paste or write a K8s manifest (Jobs, Deployments, Services,
              ConfigMaps). Supports multi-document YAML with{" "}
              <code className="text-[11px] bg-muted px-1 py-0.5 rounded font-mono">
                ---
              </code>{" "}
              separators.
            </DialogDescription>
          </DialogHeader>
          <K8sYamlEditor
            onDeployed={() => setShowYamlEditor(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
