"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Cpu,
  Globe,
  Box,
  Loader2,
  ArrowLeft,
  Eye,
  Play,
  Info,
} from "lucide-react";
import {
  useK8sTemplates,
  useK8sTemplateYaml,
  useRenderTemplate,
  useDeployManifest,
} from "@/hooks/queries/use-k8s-templates";
import K8sYamlEditor from "./k8s-yaml-editor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  variables: Array<{
    key: string;
    label: string;
    default: string;
    hint?: string;
  }>;
}

interface K8sTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployed?: () => void;
}

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Cpu,
  Globe,
  Box,
};

const CATEGORY_COLORS: Record<string, string> = {
  serving: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  web: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  utility: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

// ---------------------------------------------------------------------------
// Template Card
// ---------------------------------------------------------------------------
function TemplateCard({
  template,
  onClick,
}: {
  template: TemplateMeta;
  onClick: () => void;
}) {
  const Icon = ICON_MAP[template.icon] || Box;
  const categoryColor =
    CATEGORY_COLORS[template.category] || CATEGORY_COLORS.utility;

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-start gap-3 rounded-xl border border-border/50 bg-card/40 p-4 text-left transition-all hover:border-primary/30 hover:bg-card/60 hover:shadow-md"
    >
      <div className="flex items-start gap-3 w-full">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0 group-hover:bg-primary/15 transition-colors">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-foreground truncate">
              {template.name}
            </h4>
            <Badge
              variant="outline"
              className={`text-[10px] h-4 px-1.5 shrink-0 ${categoryColor}`}
            >
              {template.category}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {template.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {template.variables.slice(0, 4).map((v) => (
          <Badge
            key={v.key}
            variant="secondary"
            className="text-[10px] h-4 px-1.5 font-mono"
          >
            {v.key}
          </Badge>
        ))}
        {template.variables.length > 4 && (
          <Badge
            variant="secondary"
            className="text-[10px] h-4 px-1.5"
          >
            +{template.variables.length - 4} more
          </Badge>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variable Form
// ---------------------------------------------------------------------------
function VariableForm({
  template,
  values,
  onChange,
}: {
  template: TemplateMeta;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      {template.variables.map((v) => (
        <div key={v.key} className="space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-foreground">
              {v.label}
            </label>
            <code className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1 rounded">
              {`{{${v.key}}}`}
            </code>
          </div>
          <Input
            value={values[v.key] ?? v.default}
            onChange={(e) => onChange(v.key, e.target.value)}
            placeholder={v.default || v.hint || ""}
            className="h-8 text-xs font-mono"
          />
          {v.hint && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Info className="h-2.5 w-2.5 shrink-0" />
              <span>
                {v.hint.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                  /^https?:\/\//.test(part) ? (
                    <a
                      key={i}
                      href={part}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      {new URL(part).hostname}
                    </a>
                  ) : (
                    part
                  )
                )}
              </span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function K8sTemplatePicker({
  open,
  onOpenChange,
  onDeployed,
}: K8sTemplatePickerProps) {
  const { data: templates, isLoading } = useK8sTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {}
  );
  const [showPreview, setShowPreview] = useState(false);
  const [renderedYaml, setRenderedYaml] = useState("");

  const renderMutation = useRenderTemplate();
  const deployMutation = useDeployManifest();
  const { data: rawYaml } = useK8sTemplateYaml(selectedId);

  const selectedTemplate = useMemo(
    () =>
      templates?.find((t: TemplateMeta) => t.id === selectedId) || null,
    [templates, selectedId]
  );

  // Initialize variable values with defaults when selecting a template
  useEffect(() => {
    if (selectedTemplate) {
      const defaults: Record<string, string> = {};
      selectedTemplate.variables.forEach(
        (v: { key: string; default: string }) => {
          defaults[v.key] = v.default;
        }
      );
      setVariableValues(defaults);
      setShowPreview(false);
      setRenderedYaml("");
    }
  }, [selectedTemplate]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setVariableValues({});
      setShowPreview(false);
      setRenderedYaml("");
    }
  }, [open]);

  const handleVariableChange = (key: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [key]: value }));
    // If preview is showing, re-render
    if (showPreview && selectedId) {
      handlePreview({ ...variableValues, [key]: value });
    }
  };

  const handlePreview = async (vars?: Record<string, string>) => {
    if (!selectedId) return;
    try {
      const yaml = await renderMutation.mutateAsync({
        templateId: selectedId,
        variables: vars || variableValues,
      });
      setRenderedYaml(yaml || "");
      setShowPreview(true);
    } catch {
      // Error shown by toast
    }
  };

  const handleDeploy = async () => {
    if (!selectedId) return;

    // Render first if not already rendered
    let yamlToDeploy = renderedYaml;
    if (!yamlToDeploy) {
      try {
        yamlToDeploy =
          (await renderMutation.mutateAsync({
            templateId: selectedId,
            variables: variableValues,
          })) || "";
      } catch {
        return;
      }
    }

    try {
      await deployMutation.mutateAsync(yamlToDeploy);
      onDeployed?.();
      onOpenChange(false);
    } catch {
      // Error shown by toast
    }
  };

  const isDeploying = deployMutation.isLoading || renderMutation.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedTemplate ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 -ml-1"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {selectedTemplate.name}
              </>
            ) : (
              <>
                <Box className="h-5 w-5 text-primary" />
                Workload Templates
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {selectedTemplate
              ? selectedTemplate.description
              : "Choose a template to deploy a pre-configured workload."}
          </DialogDescription>
        </DialogHeader>

        {/* Template Grid */}
        {!selectedTemplate && (
          <div className="space-y-4 py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : templates && templates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((tpl: TemplateMeta) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    onClick={() => setSelectedId(tpl.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No templates available.
              </div>
            )}
          </div>
        )}

        {/* Template Configuration */}
        {selectedTemplate && !showPreview && (
          <div className="space-y-4 py-2">
            <VariableForm
              template={selectedTemplate}
              values={variableValues}
              onChange={handleVariableChange}
            />

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => handlePreview()}
                disabled={renderMutation.isLoading}
              >
                {renderMutation.isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                Preview YAML
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={handleDeploy}
                disabled={isDeploying}
              >
                {isDeploying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Deploy
              </Button>
            </div>
          </div>
        )}

        {/* YAML Preview (editable) */}
        {selectedTemplate && showPreview && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-7"
                onClick={() => setShowPreview(false)}
              >
                <ArrowLeft className="h-3 w-3" />
                Back to form
              </Button>
              <span className="text-xs text-muted-foreground">
                Edit the rendered YAML before deploying
              </span>
            </div>
            <K8sYamlEditor
              initialYaml={renderedYaml}
              onDeployed={() => {
                onDeployed?.();
                onOpenChange(false);
              }}
              height="50vh"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
