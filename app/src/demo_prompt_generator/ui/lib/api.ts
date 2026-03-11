import { useQuery, useSuspenseQuery, useMutation } from "@tanstack/react-query";
import type { UseQueryOptions, UseSuspenseQueryOptions, UseMutationOptions } from "@tanstack/react-query";
export class ApiError extends Error {
    status: number;
    statusText: string;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown){
        super(`HTTP ${status}: ${statusText}`);
        this.name = "ApiError";
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}
export interface ChatMessage {
    content: string;
    role: string;
}
export const Cloud = {
    aws: "aws",
    azure: "azure",
    gcp: "gcp"
} as const;
export type Cloud = typeof Cloud[keyof typeof Cloud];
export interface ComplexValue {
    display?: string | null;
    primary?: boolean | null;
    ref?: string | null;
    type?: string | null;
    value?: string | null;
}
export const DataSourceType = {
    synthetic: "synthetic",
    csv: "csv",
    public: "public",
    anonymized: "anonymized"
} as const;
export type DataSourceType = typeof DataSourceType[keyof typeof DataSourceType];
export interface DatabricksFeatures {
    automl?: boolean;
    databricks_apps?: boolean;
    databricks_sql?: boolean;
    delta_lake?: boolean;
    delta_live_tables?: boolean;
    feature_store?: boolean;
    genie?: boolean;
    lakehouse_monitoring?: boolean;
    mlflow?: boolean;
    model_registry?: boolean;
    model_serving?: boolean;
    mosaic_ai?: boolean;
    serverless_compute?: boolean;
    structured_streaming?: boolean;
    unity_catalog?: boolean;
    vector_search?: boolean;
    workflows_jobs?: boolean;
}
export const DeliveryFormat = {
    live_walkthrough: "live_walkthrough",
    self_guided: "self_guided",
    recorded_video: "recorded_video",
    embedded_slides: "embedded_slides",
    hands_on_lab: "hands_on_lab",
    conference_demo: "conference_demo"
} as const;
export type DeliveryFormat = typeof DeliveryFormat[keyof typeof DeliveryFormat];
export const DemoLength = {
    "5-10": "5-10",
    "15-20": "15-20",
    "30-45": "30-45",
    "60+": "60+"
} as const;
export type DemoLength = typeof DemoLength[keyof typeof DemoLength];
export interface DemoRequestIn {
    account_name?: string | null;
    additional_context?: string | null;
    branding?: string | null;
    business_problem: string;
    cloud?: Cloud | null;
    competitor?: string | null;
    data_source_type?: DataSourceType;
    date_needed?: string | null;
    delivery_formats?: DeliveryFormat[];
    demo_length?: DemoLength;
    demo_name: string;
    existing_demo?: string | null;
    features?: DatabricksFeatures;
    industry: string;
    kpis?: string[] | null;
    owner_name: string;
    owner_team?: string | null;
    primary_audience: string;
    row_count?: string | null;
    solution_summary: string;
    talking_points?: string[] | null;
    tone?: Tone;
    topics_to_avoid?: string | null;
    urgency?: Urgency | null;
    workspace_url?: string | null;
    wow_moment: string;
}
export interface GenerationListItem {
    created_at: string;
    demo_name: string;
    id: number;
    industry: string;
    stage?: string;
}
export interface GenerationOut {
    created_at: string;
    demo_name: string;
    id: number;
    industry: string;
    owner_name: string;
    proposal_md?: string | null;
    skill_files?: Record<string, string> | null;
    skill_md: string;
    stage?: string;
}
export interface HTTPValidationError {
    detail?: ValidationError[];
}
export interface InspireRequest {
    topic: string;
}
export interface Name {
    family_name?: string | null;
    given_name?: string | null;
}
export const Tone = {
    business: "business",
    technical: "technical",
    story_driven: "story_driven",
    conversational: "conversational"
} as const;
export type Tone = typeof Tone[keyof typeof Tone];
export const Urgency = {
    asap: "asap",
    normal: "normal",
    planning: "planning"
} as const;
export type Urgency = typeof Urgency[keyof typeof Urgency];
export interface User {
    active?: boolean | null;
    display_name?: string | null;
    emails?: ComplexValue[] | null;
    entitlements?: ComplexValue[] | null;
    external_id?: string | null;
    groups?: ComplexValue[] | null;
    id?: string | null;
    name?: Name | null;
    roles?: ComplexValue[] | null;
    schemas?: UserSchema[] | null;
    user_name?: string | null;
}
export const UserSchema = {
    "urn:ietf:params:scim:schemas:core:2.0:User": "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:workspace:2.0:User": "urn:ietf:params:scim:schemas:extension:workspace:2.0:User"
} as const;
export type UserSchema = typeof UserSchema[keyof typeof UserSchema];
export interface ValidationError {
    ctx?: Record<string, unknown>;
    input?: unknown;
    loc: (string | number)[];
    msg: string;
    type: string;
}
export interface VersionOut {
    version: string;
}
export interface WorkspaceApproveRequest {
    generation_id: number;
}
export interface WorkspaceBuildoutRequest {
    generation_id: number;
}
export interface WorkspaceGenerateRequest {
    topic: string;
}
export interface WorkspaceProposeRequest {
    topic: string;
}
export interface WorkspaceRefineFileRequest {
    filename: string;
    generation_id: number;
    history?: ChatMessage[];
    message: string;
}
export interface WorkspaceRefineRequest {
    focused_sections?: string[];
    generation_id: number;
    history?: ChatMessage[];
    message: string;
}
export interface CurrentUserParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const currentUser = async (params?: CurrentUserParams, options?: RequestInit): Promise<{
    data: User;
}> =>{
    const res = await fetch("/api/current-user", {
        ...options,
        method: "GET",
        headers: {
            ...(params?.["X-Forwarded-Host"] != null && {
                "X-Forwarded-Host": params["X-Forwarded-Host"]
            }),
            ...(params?.["X-Forwarded-Preferred-Username"] != null && {
                "X-Forwarded-Preferred-Username": params["X-Forwarded-Preferred-Username"]
            }),
            ...(params?.["X-Forwarded-User"] != null && {
                "X-Forwarded-User": params["X-Forwarded-User"]
            }),
            ...(params?.["X-Forwarded-Email"] != null && {
                "X-Forwarded-Email": params["X-Forwarded-Email"]
            }),
            ...(params?.["X-Request-Id"] != null && {
                "X-Request-Id": params["X-Request-Id"]
            }),
            ...(params?.["X-Forwarded-Access-Token"] != null && {
                "X-Forwarded-Access-Token": params["X-Forwarded-Access-Token"]
            }),
            ...options?.headers
        }
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export const currentUserKey = (params?: CurrentUserParams)=>{
    return [
        "/api/current-user",
        params
    ] as const;
};
export function useCurrentUser<TData = {
    data: User;
}>(options?: {
    params?: CurrentUserParams;
    query?: Omit<UseQueryOptions<{
        data: User;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: currentUserKey(options?.params),
        queryFn: ()=>currentUser(options?.params),
        ...options?.query
    });
}
export function useCurrentUserSuspense<TData = {
    data: User;
}>(options?: {
    params?: CurrentUserParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: User;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: currentUserKey(options?.params),
        queryFn: ()=>currentUser(options?.params),
        ...options?.query
    });
}
export const generateSkill = async (data: DemoRequestIn, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch("/api/generate", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useGenerateSkill(options?: {
    mutation?: UseMutationOptions<{
        data: GenerationOut;
    }, ApiError, DemoRequestIn>;
}) {
    return useMutation({
        mutationFn: (data)=>generateSkill(data),
        ...options?.mutation
    });
}
export const listGenerations = async (options?: RequestInit): Promise<{
    data: GenerationListItem[];
}> =>{
    const res = await fetch("/api/generations", {
        ...options,
        method: "GET"
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export const listGenerationsKey = ()=>{
    return [
        "/api/generations"
    ] as const;
};
export function useListGenerations<TData = {
    data: GenerationListItem[];
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listGenerationsKey(),
        queryFn: ()=>listGenerations(),
        ...options?.query
    });
}
export function useListGenerationsSuspense<TData = {
    data: GenerationListItem[];
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listGenerationsKey(),
        queryFn: ()=>listGenerations(),
        ...options?.query
    });
}
export interface GetGenerationParams {
    generation_id: number;
}
export const getGeneration = async (params: GetGenerationParams, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch(`/api/generations/${params.generation_id}`, {
        ...options,
        method: "GET"
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export const getGenerationKey = (params?: GetGenerationParams)=>{
    return [
        "/api/generations/{generation_id}",
        params
    ] as const;
};
export function useGetGeneration<TData = {
    data: GenerationOut;
}>(options: {
    params: GetGenerationParams;
    query?: Omit<UseQueryOptions<{
        data: GenerationOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getGenerationKey(options.params),
        queryFn: ()=>getGeneration(options.params),
        ...options?.query
    });
}
export function useGetGenerationSuspense<TData = {
    data: GenerationOut;
}>(options: {
    params: GetGenerationParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: GenerationOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getGenerationKey(options.params),
        queryFn: ()=>getGeneration(options.params),
        ...options?.query
    });
}
export const streamInspiration = async (data: InspireRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/inspire", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useStreamInspiration(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, InspireRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>streamInspiration(data),
        ...options?.mutation
    });
}
export const version = async (options?: RequestInit): Promise<{
    data: VersionOut;
}> =>{
    const res = await fetch("/api/version", {
        ...options,
        method: "GET"
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export const versionKey = ()=>{
    return [
        "/api/version"
    ] as const;
};
export function useVersion<TData = {
    data: VersionOut;
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: VersionOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: versionKey(),
        queryFn: ()=>version(),
        ...options?.query
    });
}
export function useVersionSuspense<TData = {
    data: VersionOut;
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: VersionOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: versionKey(),
        queryFn: ()=>version(),
        ...options?.query
    });
}
export const workspaceApprove = async (data: WorkspaceApproveRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/approve", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceApprove(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceApproveRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceApprove(data),
        ...options?.mutation
    });
}
export const workspaceBuildout = async (data: WorkspaceBuildoutRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/buildout", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceBuildout(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceBuildoutRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceBuildout(data),
        ...options?.mutation
    });
}
export const workspaceGenerate = async (data: WorkspaceGenerateRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/generate", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceGenerate(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceGenerateRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceGenerate(data),
        ...options?.mutation
    });
}
export const workspacePropose = async (data: WorkspaceProposeRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/propose", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspacePropose(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceProposeRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspacePropose(data),
        ...options?.mutation
    });
}
export const workspaceProposeRefine = async (data: WorkspaceRefineRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/propose/refine", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceProposeRefine(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceRefineRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceProposeRefine(data),
        ...options?.mutation
    });
}
export const workspaceRefine = async (data: WorkspaceRefineRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/refine", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceRefine(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceRefineRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceRefine(data),
        ...options?.mutation
    });
}
export const workspaceRefineFile = async (data: WorkspaceRefineFileRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/refine-file", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...options?.headers
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export function useWorkspaceRefineFile(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, WorkspaceRefineFileRequest>;
}) {
    return useMutation({
        mutationFn: (data)=>workspaceRefineFile(data),
        ...options?.mutation
    });
}
export interface WorkspaceDownloadParams {
    generation_id: number;
}
export const workspaceDownload = async (params: WorkspaceDownloadParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/workspace/${params.generation_id}/download`, {
        ...options,
        method: "GET"
    });
    if (!res.ok) {
        const body = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch  {
            parsed = body;
        }
        throw new ApiError(res.status, res.statusText, parsed);
    }
    return {
        data: await res.json()
    };
};
export const workspaceDownloadKey = (params?: WorkspaceDownloadParams)=>{
    return [
        "/api/workspace/{generation_id}/download",
        params
    ] as const;
};
export function useWorkspaceDownload<TData = {
    data: unknown;
}>(options: {
    params: WorkspaceDownloadParams;
    query?: Omit<UseQueryOptions<{
        data: unknown;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: workspaceDownloadKey(options.params),
        queryFn: ()=>workspaceDownload(options.params),
        ...options?.query
    });
}
export function useWorkspaceDownloadSuspense<TData = {
    data: unknown;
}>(options: {
    params: WorkspaceDownloadParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: unknown;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: workspaceDownloadKey(options.params),
        queryFn: ()=>workspaceDownload(options.params),
        ...options?.query
    });
}
