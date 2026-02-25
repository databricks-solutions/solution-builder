import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
  ChevronLeft,
} from "lucide-react";
import type { DemoRequestIn, DatabricksFeatures } from "@/lib/api";
import { useGenerateSkill } from "@/lib/api";
import { defaultFormValues } from "@/lib/custom-api";
import Navbar from "@/components/apx/navbar";

export const Route = createFileRoute("/new")({
  component: NewDemoPage,
});

const STEPS = [
  "The Basics",
  "The Story",
  "Demo Content",
  "Look & Feel",
  "Constraints",
  "Review",
] as const;

const FEATURE_LABELS: Record<keyof DatabricksFeatures, string> = {
  delta_lake: "Delta Lake",
  delta_live_tables: "Delta Live Tables / SDP",
  unity_catalog: "Unity Catalog",
  databricks_sql: "Databricks SQL / Dashboards",
  mlflow: "MLflow / Experiments",
  model_registry: "Model Registry",
  model_serving: "Model Serving",
  feature_store: "Feature Store",
  automl: "AutoML",
  mosaic_ai: "Mosaic AI / LLM Agents",
  vector_search: "Vector Search",
  structured_streaming: "Structured Streaming",
  serverless_compute: "Serverless Compute",
  workflows_jobs: "Workflows / Jobs",
  genie: "Genie (AI/BI)",
  databricks_apps: "Databricks Apps",
  lakehouse_monitoring: "Lakehouse Monitoring",
};

function NewDemoPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DemoRequestIn>({ ...defaultFormValues });
  const navigate = useNavigate();
  const generate = useGenerateSkill();

  const set = useCallback(
    <K extends keyof DemoRequestIn>(key: K, val: DemoRequestIn[K]) =>
      setForm((prev) => ({ ...prev, [key]: val })),
    [],
  );

  const toggleFeature = useCallback(
    (key: keyof DatabricksFeatures) =>
      setForm((prev) => ({
        ...prev,
        features: { ...prev.features, [key]: !prev.features[key] },
      })),
    [],
  );

  const canAdvance = (): boolean => {
    if (step === 0)
      return !!(form.demo_name && form.owner_name && form.primary_audience);
    if (step === 1)
      return !!(form.business_problem && form.wow_moment);
    if (step === 2)
      return !!(form.solution_summary && form.industry);
    return true;
  };

  const handleSubmit = () => {
    generate.mutate(form, {
      onSuccess: (resp) => navigate({ to: "/generations/$id", params: { id: String(resp.data.id) } }),
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate({ to: "/" })}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Home
        </Button>

        {/* Step indicator */}
        <div className="mb-8 space-y-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="font-medium text-foreground">{STEPS[step]}</span>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => i < step && setStep(i)}
                className={`transition-colors ${i <= step ? "text-foreground font-medium" : ""} ${i < step ? "cursor-pointer hover:underline" : "cursor-default"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {STEPS[step]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 0 && <StepBasics form={form} set={set} />}
            {step === 1 && <StepStory form={form} set={set} />}
            {step === 2 && (
              <StepContent
                form={form}
                set={set}
                toggleFeature={toggleFeature}
              />
            )}
            {step === 3 && <StepLookFeel form={form} set={set} />}
            {step === 4 && <StepConstraints form={form} set={set} />}
            {step === 5 && <StepReview form={form} />}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={generate.isPending || !canAdvance()}>
              {generate.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate SKILL.md
                </>
              )}
            </Button>
          )}
        </div>
        {generate.isError && (
          <p className="mt-3 text-sm text-destructive">{generate.error.message}</p>
        )}
      </div>
    </div>
  );
}

// ─── Step Components ────────────────────────────────────────────────────────

type SetFn = <K extends keyof DemoRequestIn>(key: K, val: DemoRequestIn[K]) => void;

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function StepBasics({ form, set }: { form: DemoRequestIn; set: SetFn }) {
  return (
    <>
      <Field label="Demo Name" required>
        <Input
          placeholder="e.g. retail-demand-forecasting"
          value={form.demo_name}
          onChange={(e) => set("demo_name", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Your Name" required>
          <Input
            value={form.owner_name}
            onChange={(e) => set("owner_name", e.target.value)}
          />
        </Field>
        <Field label="Team / Role">
          <Input
            value={form.owner_team || ""}
            onChange={(e) => set("owner_team", e.target.value || null)}
          />
        </Field>
      </div>
      <Field label="Primary Audience" required>
        <Input
          placeholder="Who will be in the room?"
          value={form.primary_audience}
          onChange={(e) => set("primary_audience", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Account / Company">
          <Input
            placeholder="Company name or 'internal'"
            value={form.account_name || ""}
            onChange={(e) => set("account_name", e.target.value || null)}
          />
        </Field>
        <Field label="Date Needed">
          <Input
            type="date"
            value={form.date_needed || ""}
            onChange={(e) => set("date_needed", e.target.value || null)}
          />
        </Field>
      </div>
      <Field label="Urgency">
        <RadioGroup
          value={form.urgency || "normal"}
          onValueChange={(v) => set("urgency", v as DemoRequestIn["urgency"])}
          className="flex gap-4"
        >
          {(["asap", "normal", "planning"] as const).map((u) => (
            <div key={u} className="flex items-center gap-1.5">
              <RadioGroupItem value={u} id={`urg-${u}`} />
              <Label htmlFor={`urg-${u}`} className="cursor-pointer capitalize">
                {u}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </Field>
    </>
  );
}

function StepStory({ form, set }: { form: DemoRequestIn; set: SetFn }) {
  return (
    <>
      <Field label="Business Problem" required>
        <Textarea
          placeholder="What pain point does the customer face?"
          rows={3}
          value={form.business_problem}
          onChange={(e) => set("business_problem", e.target.value)}
        />
      </Field>
      <Field label="Wow Moment" required>
        <Textarea
          placeholder="What should the audience believe after the demo?"
          rows={2}
          value={form.wow_moment}
          onChange={(e) => set("wow_moment", e.target.value)}
        />
      </Field>
      <Field label="Key Talking Points">
        <Textarea
          placeholder="One per line"
          rows={3}
          value={(form.talking_points || []).join("\n")}
          onChange={(e) =>
            set(
              "talking_points",
              e.target.value.split("\n").filter(Boolean),
            )
          }
        />
      </Field>
      <Field label="Competitor to Position Against">
        <Input
          placeholder="(optional)"
          value={form.competitor || ""}
          onChange={(e) => set("competitor", e.target.value || null)}
        />
      </Field>
    </>
  );
}

function StepContent({
  form,
  set,
  toggleFeature,
}: {
  form: DemoRequestIn;
  set: SetFn;
  toggleFeature: (k: keyof DatabricksFeatures) => void;
}) {
  return (
    <>
      <Field label="Solution Summary / Scenario" required>
        <Textarea
          placeholder="Describe the main use-case scenario"
          rows={3}
          value={form.solution_summary}
          onChange={(e) => set("solution_summary", e.target.value)}
        />
      </Field>
      <Field label="Industry / Domain" required>
        <Input
          placeholder="e.g. Financial Services, Healthcare, Retail"
          value={form.industry}
          onChange={(e) => set("industry", e.target.value)}
        />
      </Field>

      <div className="space-y-2">
        <Label>Databricks Features</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.entries(FEATURE_LABELS) as [keyof DatabricksFeatures, string][]).map(
            ([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={form.features[key]}
                  onCheckedChange={() => toggleFeature(key)}
                />
                {label}
              </label>
            ),
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Data Source">
          <Select
            value={form.data_source_type}
            onValueChange={(v) =>
              set("data_source_type", v as DemoRequestIn["data_source_type"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="synthetic">Synthetic (generated)</SelectItem>
              <SelectItem value="csv">CSV Upload</SelectItem>
              <SelectItem value="public">Public Dataset</SelectItem>
              <SelectItem value="anonymized">Anonymized Real Data</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Approx. Row Count">
          <Input
            placeholder="e.g. 1M"
            value={form.row_count || ""}
            onChange={(e) => set("row_count", e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="KPIs / Metrics">
        <Textarea
          placeholder="One per line"
          rows={2}
          value={(form.kpis || []).join("\n")}
          onChange={(e) =>
            set("kpis", e.target.value.split("\n").filter(Boolean))
          }
        />
      </Field>
    </>
  );
}

function StepLookFeel({ form, set }: { form: DemoRequestIn; set: SetFn }) {
  const deliveryOptions = [
    { value: "live_walkthrough", label: "Live Walkthrough" },
    { value: "self_guided", label: "Self-Guided" },
    { value: "recorded_video", label: "Recorded Video" },
    { value: "embedded_slides", label: "Embedded Slides" },
    { value: "hands_on_lab", label: "Hands-on Lab" },
    { value: "conference_demo", label: "Conference Demo" },
  ];

  const toggleDelivery = (val: string) =>
    set(
      "delivery_formats",
      form.delivery_formats.includes(val)
        ? form.delivery_formats.filter((d) => d !== val)
        : [...form.delivery_formats, val],
    );

  return (
    <>
      <div className="space-y-2">
        <Label>Delivery Format(s)</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {deliveryOptions.map(({ value, label }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <Checkbox
                checked={form.delivery_formats.includes(value)}
                onCheckedChange={() => toggleDelivery(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Demo Length">
          <Select
            value={form.demo_length}
            onValueChange={(v) => set("demo_length", v as DemoRequestIn["demo_length"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5-10">5–10 min (short)</SelectItem>
              <SelectItem value="15-20">15–20 min (standard)</SelectItem>
              <SelectItem value="30-45">30–45 min (deep dive)</SelectItem>
              <SelectItem value="60+">60+ min (workshop)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tone">
          <Select
            value={form.tone}
            onValueChange={(v) => set("tone", v as DemoRequestIn["tone"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business">Business / Executive</SelectItem>
              <SelectItem value="technical">Technical / Developer</SelectItem>
              <SelectItem value="story_driven">Story-Driven</SelectItem>
              <SelectItem value="conversational">Conversational</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Customer Branding Notes">
        <Input
          placeholder="Colors, logos, terminology preferences"
          value={form.branding || ""}
          onChange={(e) => set("branding", e.target.value || null)}
        />
      </Field>
    </>
  );
}

function StepConstraints({ form, set }: { form: DemoRequestIn; set: SetFn }) {
  return (
    <>
      <Field label="Topics to Avoid">
        <Textarea
          placeholder="Anything off-limits?"
          rows={2}
          value={form.topics_to_avoid || ""}
          onChange={(e) => set("topics_to_avoid", e.target.value || null)}
        />
      </Field>
      <Field label="Extend Existing Demo?">
        <Input
          placeholder="Link or name of existing demo to build on"
          value={form.existing_demo || ""}
          onChange={(e) => set("existing_demo", e.target.value || null)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Workspace URL">
          <Input
            placeholder="https://..."
            value={form.workspace_url || ""}
            onChange={(e) => set("workspace_url", e.target.value || null)}
          />
        </Field>
        <Field label="Cloud">
          <Select
            value={form.cloud || "aws"}
            onValueChange={(v) => set("cloud", v as DemoRequestIn["cloud"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aws">AWS</SelectItem>
              <SelectItem value="azure">Azure</SelectItem>
              <SelectItem value="gcp">GCP</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Additional Context">
        <Textarea
          placeholder="Anything else the demo builder should know?"
          rows={3}
          value={form.additional_context || ""}
          onChange={(e) => set("additional_context", e.target.value || null)}
        />
      </Field>
    </>
  );
}

function StepReview({ form }: { form: DemoRequestIn }) {
  const selectedFeatures = (
    Object.entries(form.features) as [keyof DatabricksFeatures, boolean][]
  )
    .filter(([, v]) => v)
    .map(([k]) => FEATURE_LABELS[k]);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Review your inputs below, then click <strong>Generate SKILL.md</strong>.
      </p>
      <ReviewRow label="Demo Name" value={form.demo_name} />
      <ReviewRow label="Owner" value={`${form.owner_name}${form.owner_team ? ` (${form.owner_team})` : ""}`} />
      <ReviewRow label="Audience" value={form.primary_audience} />
      <ReviewRow label="Account" value={form.account_name} />
      <ReviewRow label="Industry" value={form.industry} />
      <ReviewRow label="Business Problem" value={form.business_problem} />
      <ReviewRow label="Wow Moment" value={form.wow_moment} />
      <ReviewRow label="Scenario" value={form.solution_summary} />
      <ReviewRow
        label="Features"
        value={selectedFeatures.length ? selectedFeatures.join(", ") : "(none)"}
      />
      <ReviewRow label="Data Source" value={form.data_source_type} />
      <ReviewRow label="Length" value={`${form.demo_length} min`} />
      <ReviewRow label="Tone" value={form.tone} />
      <ReviewRow label="Cloud" value={form.cloud || "aws"} />
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 border-b pb-2">
      <span className="w-36 shrink-0 font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value || "—"}</span>
    </div>
  );
}
