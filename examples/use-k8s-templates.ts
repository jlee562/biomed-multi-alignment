import { useQuery, useMutation, useQueryClient } from "react-query";
import {
  getK8sTemplates,
  getK8sTemplateContent,
  renderK8sTemplate,
  deployK8sManifest,
  validateK8sManifest,
} from "@/app/actions/k8s-actions";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch the template catalog (metadata only, no YAML content) */
export function useK8sTemplates() {
  return useQuery(
    ["k8sTemplates"],
    async () => {
      const result = await getK8sTemplates();
      if (!result.success) {
        throw new Error("Failed to fetch templates");
      }
      return result.templates;
    },
    {
      staleTime: 60_000 * 5, // templates rarely change — 5 min cache
      cacheTime: 60_000 * 30,
    }
  );
}

/** Fetch the raw YAML content for a single template */
export function useK8sTemplateYaml(templateId: string | null) {
  return useQuery(
    ["k8sTemplateYaml", templateId],
    async () => {
      if (!templateId) return null;
      const result = await getK8sTemplateContent(templateId);
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch template");
      }
      return result.yaml;
    },
    {
      enabled: !!templateId,
      staleTime: 60_000 * 5,
      cacheTime: 60_000 * 30,
    }
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Render a template with variable substitutions */
export function useRenderTemplate() {
  return useMutation(
    async ({
      templateId,
      variables,
    }: {
      templateId: string;
      variables: Record<string, string>;
    }) => {
      const result = await renderK8sTemplate(templateId, variables);
      if (!result.success) {
        throw new Error(result.error || "Failed to render template");
      }
      return result.yaml;
    }
  );
}

/** Deploy a YAML manifest string */
export function useDeployManifest() {
  const queryClient = useQueryClient();

  return useMutation(
    async (yamlString: string) => {
      const result = await deployK8sManifest(yamlString);
      if (!result.success) {
        throw new Error(result.error || "Failed to deploy manifest");
      }
      return result;
    },
    {
      onSuccess: (data) => {
        // Invalidate all workload-related queries so the UI refreshes
        queryClient.invalidateQueries(["k8sDeployments"]);
        queryClient.invalidateQueries(["k8sJobs"]);
        queryClient.invalidateQueries(["k8sServices"]);
        queryClient.invalidateQueries(["k8sResourceUsage"]);
        queryClient.invalidateQueries(["k8sEvents"]);
        queryClient.invalidateQueries(["k8sNamespaceOverview"]);
        toast.success(data.message || "Workload deployed successfully");
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to deploy workload");
      },
    }
  );
}

/** Validate YAML manifest without deploying */
export function useValidateManifest() {
  return useMutation(async (yamlString: string) => {
    const result = await validateK8sManifest(yamlString);
    return result;
  });
}
