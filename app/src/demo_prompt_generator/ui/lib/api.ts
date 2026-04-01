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
export interface Body_importGeneration {
    file: string;
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
export interface ConversationOut {
    created_at: string;
    generation_id: number;
    id: number;
    title: string;
    updated_at: string;
}
export interface ConversationWithMessages {
    created_at: string;
    generation_id: number;
    id: number;
    messages: ChatMessage[];
    title: string;
    updated_at: string;
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
    is_library?: boolean;
    is_starred?: boolean;
    library_tags?: string[] | null;
    stage?: string;
}
export interface GenerationOut {
    created_at: string;
    demo_name: string;
    id: number;
    industry: string;
    is_library?: boolean;
    is_starred?: boolean;
    library_tags?: string[] | null;
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
export interface SaveMessagesRequest {
    generation_id: number;
    messages: ChatMessage[];
}
export interface StarRequest {
    is_starred: boolean;
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
export interface WorkspaceAgentRefineRequest {
    generation_id: number;
    history?: ChatMessage[];
    message: string;
}
export interface WorkspaceApproveRequest {
    generation_id: number;
}
export interface WorkspaceBuildRequest {
    generation_id: number;
}
export interface WorkspaceBuildoutFileRequest {
    filename: string;
    generated_files?: Record<string, string>;
    generation_id: number;
    user_architecture?: string | null;
}
export interface WorkspaceBuildoutRequest {
    files_payload?: string | null;
    generation_id: number;
    user_architecture?: string | null;
}
export interface WorkspaceBuildoutSaveRequest {
    files: Record<string, string>;
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
export interface ListConversationsParams {
    generation_id?: number | null;
}
export const listConversations = async (params?: ListConversationsParams, options?: RequestInit): Promise<{
    data: ConversationOut[];
}> =>{
    const searchParams = new URLSearchParams();
    if (params?.generation_id != null) searchParams.set("generation_id", String(params?.generation_id));
    const queryString = searchParams.toString();
    const url = queryString ? `/api/conversations?${queryString}` : "/api/conversations";
    const res = await fetch(url, {
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
export const listConversationsKey = (params?: ListConversationsParams)=>{
    return [
        "/api/conversations",
        params
    ] as const;
};
export function useListConversations<TData = {
    data: ConversationOut[];
}>(options?: {
    params?: ListConversationsParams;
    query?: Omit<UseQueryOptions<{
        data: ConversationOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listConversationsKey(options?.params),
        queryFn: ()=>listConversations(options?.params),
        ...options?.query
    });
}
export function useListConversationsSuspense<TData = {
    data: ConversationOut[];
}>(options?: {
    params?: ListConversationsParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ConversationOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listConversationsKey(options?.params),
        queryFn: ()=>listConversations(options?.params),
        ...options?.query
    });
}
export interface SaveConversationParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const saveConversation = async (data: SaveMessagesRequest, params?: SaveConversationParams, options?: RequestInit): Promise<{
    data: ConversationOut;
}> =>{
    const res = await fetch("/api/conversations/save", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useSaveConversation(options?: {
    mutation?: UseMutationOptions<{
        data: ConversationOut;
    }, ApiError, {
        params: SaveConversationParams;
        data: SaveMessagesRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>saveConversation(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface GetConversationParams {
    conversation_id: number;
}
export const getConversation = async (params: GetConversationParams, options?: RequestInit): Promise<{
    data: ConversationWithMessages;
}> =>{
    const res = await fetch(`/api/conversations/${params.conversation_id}`, {
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
export const getConversationKey = (params?: GetConversationParams)=>{
    return [
        "/api/conversations/{conversation_id}",
        params
    ] as const;
};
export function useGetConversation<TData = {
    data: ConversationWithMessages;
}>(options: {
    params: GetConversationParams;
    query?: Omit<UseQueryOptions<{
        data: ConversationWithMessages;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getConversationKey(options.params),
        queryFn: ()=>getConversation(options.params),
        ...options?.query
    });
}
export function useGetConversationSuspense<TData = {
    data: ConversationWithMessages;
}>(options: {
    params: GetConversationParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ConversationWithMessages;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getConversationKey(options.params),
        queryFn: ()=>getConversation(options.params),
        ...options?.query
    });
}
export interface DeleteConversationParams {
    conversation_id: number;
}
export const deleteConversation = async (params: DeleteConversationParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/conversations/${params.conversation_id}`, {
        ...options,
        method: "DELETE"
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
export function useDeleteConversation(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: DeleteConversationParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>deleteConversation(vars.params),
        ...options?.mutation
    });
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
export interface ListGenerationsParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listGenerations = async (params?: ListGenerationsParams, options?: RequestInit): Promise<{
    data: GenerationListItem[];
}> =>{
    const res = await fetch("/api/generations", {
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
export const listGenerationsKey = (params?: ListGenerationsParams)=>{
    return [
        "/api/generations",
        params
    ] as const;
};
export function useListGenerations<TData = {
    data: GenerationListItem[];
}>(options?: {
    params?: ListGenerationsParams;
    query?: Omit<UseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listGenerationsKey(options?.params),
        queryFn: ()=>listGenerations(options?.params),
        ...options?.query
    });
}
export function useListGenerationsSuspense<TData = {
    data: GenerationListItem[];
}>(options?: {
    params?: ListGenerationsParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listGenerationsKey(options?.params),
        queryFn: ()=>listGenerations(options?.params),
        ...options?.query
    });
}
export interface ImportGenerationParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const importGeneration = async (data: FormData, params?: ImportGenerationParams, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch("/api/generations/import", {
        ...options,
        method: "POST",
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
        },
        body: data
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
export function useImportGeneration(options?: {
    mutation?: UseMutationOptions<{
        data: GenerationOut;
    }, ApiError, {
        params: ImportGenerationParams;
        data: FormData;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>importGeneration(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface GetGenerationParams {
    generation_id: number;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getGeneration = async (params: GetGenerationParams, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch(`/api/generations/${params.generation_id}`, {
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
export interface ToggleGenerationStarParams {
    generation_id: number;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const toggleGenerationStar = async (params: ToggleGenerationStarParams, data: StarRequest, options?: RequestInit): Promise<{
    data: GenerationListItem;
}> =>{
    const res = await fetch(`/api/generations/${params.generation_id}/star`, {
        ...options,
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
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
export function useToggleGenerationStar(options?: {
    mutation?: UseMutationOptions<{
        data: GenerationListItem;
    }, ApiError, {
        params: ToggleGenerationStarParams;
        data: StarRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>toggleGenerationStar(vars.params, vars.data),
        ...options?.mutation
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
export const listLibrary = async (options?: RequestInit): Promise<{
    data: GenerationListItem[];
}> =>{
    const res = await fetch("/api/library", {
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
export const listLibraryKey = ()=>{
    return [
        "/api/library"
    ] as const;
};
export function useListLibrary<TData = {
    data: GenerationListItem[];
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listLibraryKey(),
        queryFn: ()=>listLibrary(),
        ...options?.query
    });
}
export function useListLibrarySuspense<TData = {
    data: GenerationListItem[];
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: GenerationListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listLibraryKey(),
        queryFn: ()=>listLibrary(),
        ...options?.query
    });
}
export interface GetLibraryPackageParams {
    package_id: number;
}
export const getLibraryPackage = async (params: GetLibraryPackageParams, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch(`/api/library/${params.package_id}`, {
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
export const getLibraryPackageKey = (params?: GetLibraryPackageParams)=>{
    return [
        "/api/library/{package_id}",
        params
    ] as const;
};
export function useGetLibraryPackage<TData = {
    data: GenerationOut;
}>(options: {
    params: GetLibraryPackageParams;
    query?: Omit<UseQueryOptions<{
        data: GenerationOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getLibraryPackageKey(options.params),
        queryFn: ()=>getLibraryPackage(options.params),
        ...options?.query
    });
}
export function useGetLibraryPackageSuspense<TData = {
    data: GenerationOut;
}>(options: {
    params: GetLibraryPackageParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: GenerationOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getLibraryPackageKey(options.params),
        queryFn: ()=>getLibraryPackage(options.params),
        ...options?.query
    });
}
export interface ForkLibraryPackageParams {
    package_id: number;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const forkLibraryPackage = async (params: ForkLibraryPackageParams, options?: RequestInit): Promise<{
    data: GenerationOut;
}> =>{
    const res = await fetch(`/api/library/${params.package_id}/fork`, {
        ...options,
        method: "POST",
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
export function useForkLibraryPackage(options?: {
    mutation?: UseMutationOptions<{
        data: GenerationOut;
    }, ApiError, {
        params: ForkLibraryPackageParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>forkLibraryPackage(vars.params),
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
export interface WorkspaceAgentRefineParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceAgentRefine = async (data: WorkspaceAgentRefineRequest, params?: WorkspaceAgentRefineParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/agent-refine", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useWorkspaceAgentRefine(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: WorkspaceAgentRefineParams;
        data: WorkspaceAgentRefineRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceAgentRefine(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceApproveParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceApprove = async (data: WorkspaceApproveRequest, params?: WorkspaceApproveParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/approve", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceApproveParams;
        data: WorkspaceApproveRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceApprove(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceBuildParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceBuild = async (data: WorkspaceBuildRequest, params?: WorkspaceBuildParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/build", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useWorkspaceBuild(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: WorkspaceBuildParams;
        data: WorkspaceBuildRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceBuild(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceBuildoutParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceBuildout = async (data: WorkspaceBuildoutRequest, params?: WorkspaceBuildoutParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/buildout", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceBuildoutParams;
        data: WorkspaceBuildoutRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceBuildout(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceBuildoutFileParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceBuildoutFile = async (data: WorkspaceBuildoutFileRequest, params?: WorkspaceBuildoutFileParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/buildout-file", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useWorkspaceBuildoutFile(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: WorkspaceBuildoutFileParams;
        data: WorkspaceBuildoutFileRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceBuildoutFile(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceBuildoutFinalizeParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceBuildoutFinalize = async (data: WorkspaceBuildoutRequest, params?: WorkspaceBuildoutFinalizeParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/buildout-finalize", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useWorkspaceBuildoutFinalize(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: WorkspaceBuildoutFinalizeParams;
        data: WorkspaceBuildoutRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceBuildoutFinalize(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceBuildoutSaveParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceBuildoutSave = async (data: WorkspaceBuildoutSaveRequest, params?: WorkspaceBuildoutSaveParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/buildout-save", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
export function useWorkspaceBuildoutSave(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: WorkspaceBuildoutSaveParams;
        data: WorkspaceBuildoutSaveRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceBuildoutSave(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceGenerateParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceGenerate = async (data: WorkspaceGenerateRequest, params?: WorkspaceGenerateParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/generate", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceGenerateParams;
        data: WorkspaceGenerateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceGenerate(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceProposeParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspacePropose = async (data: WorkspaceProposeRequest, params?: WorkspaceProposeParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/propose", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceProposeParams;
        data: WorkspaceProposeRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspacePropose(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceProposeRefineParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceProposeRefine = async (data: WorkspaceRefineRequest, params?: WorkspaceProposeRefineParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/propose/refine", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceProposeRefineParams;
        data: WorkspaceRefineRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceProposeRefine(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceRefineParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceRefine = async (data: WorkspaceRefineRequest, params?: WorkspaceRefineParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/refine", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceRefineParams;
        data: WorkspaceRefineRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceRefine(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceRefineFileParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceRefineFile = async (data: WorkspaceRefineFileRequest, params?: WorkspaceRefineFileParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch("/api/workspace/refine-file", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
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
    }, ApiError, {
        params: WorkspaceRefineFileParams;
        data: WorkspaceRefineFileRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>workspaceRefineFile(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface WorkspaceDownloadParams {
    generation_id: number;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const workspaceDownload = async (params: WorkspaceDownloadParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/workspace/${params.generation_id}/download`, {
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
