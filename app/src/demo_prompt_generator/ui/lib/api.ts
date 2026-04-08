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
export interface ActiveExecutionOut {
    execution_id: string;
    is_running: boolean;
    project_id: string;
}
export interface Capability {
    category: string;
    id: string;
    name: string;
}
export interface ClusterInfo {
    id: string;
    name: string;
    spark_version?: string | null;
    state?: string | null;
}
export interface ComplexValue {
    display?: string | null;
    primary?: boolean | null;
    ref?: string | null;
    type?: string | null;
    value?: string | null;
}
export interface CreateProjectFromTemplateRequest {
    name: string;
}
export interface HTTPValidationError {
    detail?: ValidationError[];
}
export interface InvokeAgentRequest {
    message: string;
    project_id: string;
}
export interface InvokeAgentResponse {
    execution_id: string;
    project_id: string;
}
export interface MessageCreateRequest {
    content: string;
    is_error?: boolean;
    role: string;
}
export interface MessageOut {
    content: string;
    created_at: string;
    id: number;
    is_error: boolean;
    project_id: string;
    reasoning_data?: Record<string, unknown> | null;
    role: string;
}
export interface Name {
    family_name?: string | null;
    given_name?: string | null;
}
export interface ProjectCreateRequest {
    description: string;
}
export interface ProjectFileContent {
    content: string;
    last_modified?: string | null;
    path: string;
    size: number;
}
export interface ProjectFileOut {
    last_modified: string;
    name: string;
    path: string;
    size: number;
    synced_at: string;
}
export interface ProjectListItem {
    created_at: string;
    file_count?: number;
    id: string;
    message_count?: number;
    name: string;
    project_type: string;
    updated_at: string;
}
export interface ProjectOut {
    cluster_id?: string | null;
    cluster_name?: string | null;
    created_at: string;
    default_catalog?: string | null;
    default_schema?: string | null;
    description: string | null;
    file_count?: number;
    id: string;
    message_count?: number;
    name: string;
    project_type: string;
    updated_at: string;
    user_email: string;
    warehouse_id?: string | null;
    warehouse_name?: string | null;
}
export interface ProjectResourcesUpdateRequest {
    cluster_id?: string | null;
    cluster_name?: string | null;
    default_catalog?: string | null;
    default_schema?: string | null;
    warehouse_id?: string | null;
    warehouse_name?: string | null;
}
export interface ProjectUpdateRequest {
    description?: string | null;
    name?: string | null;
}
export interface ResourceDefaults {
    catalog?: string;
    schema_prefix?: string;
}
export interface SearchTemplatesRequest {
    limit?: number;
    query: string;
}
export interface SkillFileContent {
    content: string;
    path: string;
}
export interface SkillInfo {
    description: string;
    dir_name: string;
    name: string;
}
export interface StreamProgressRequest {
    last_timestamp?: number;
}
export interface SystemPromptResponse {
    prompt: string;
}
export interface TemplateAdminStatus {
    is_admin: boolean;
}
export interface TemplateDetail {
    capabilities?: string[] | null;
    description: string | null;
    file_count?: number;
    full_description: string | null;
    id: string;
    industry: string | null;
    name: string;
    owner_email: string;
    reviewed_at?: string | null;
    reviewed_by?: string | null;
    source_project_id?: string | null;
    status: string;
    submitted_at: string;
}
export interface TemplateFile {
    is_dir?: boolean;
    name: string;
    path: string;
    size: number;
}
export interface TemplateFileContent {
    content: string;
    path: string;
    size: number;
}
export interface TemplateListItem {
    capabilities?: string[] | null;
    description: string | null;
    id: string;
    industry: string | null;
    name: string;
    owner_email: string;
    reviewed_at?: string | null;
    status: string;
    submitted_at: string;
}
export interface TemplateSearchResult {
    capabilities?: string[] | null;
    description: string | null;
    id: string;
    industry: string | null;
    name: string;
    similarity: number;
}
export interface TemplateStatusUpdateRequest {
    status: string;
}
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
export interface WarehouseInfo {
    id: string;
    name: string;
    size?: string | null;
    state?: string | null;
}
export const getCapabilities = async (options?: RequestInit): Promise<{
    data: Capability[];
}> =>{
    const res = await fetch("/api/constants/capabilities", {
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
export const getCapabilitiesKey = ()=>{
    return [
        "/api/constants/capabilities"
    ] as const;
};
export function useGetCapabilities<TData = {
    data: Capability[];
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: Capability[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getCapabilitiesKey(),
        queryFn: ()=>getCapabilities(),
        ...options?.query
    });
}
export function useGetCapabilitiesSuspense<TData = {
    data: Capability[];
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: Capability[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getCapabilitiesKey(),
        queryFn: ()=>getCapabilities(),
        ...options?.query
    });
}
export const getIndustries = async (options?: RequestInit): Promise<{
    data: string[];
}> =>{
    const res = await fetch("/api/constants/industries", {
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
export const getIndustriesKey = ()=>{
    return [
        "/api/constants/industries"
    ] as const;
};
export function useGetIndustries<TData = {
    data: string[];
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getIndustriesKey(),
        queryFn: ()=>getIndustries(),
        ...options?.query
    });
}
export function useGetIndustriesSuspense<TData = {
    data: string[];
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getIndustriesKey(),
        queryFn: ()=>getIndustries(),
        ...options?.query
    });
}
export interface GetTemplateAdminStatusParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getTemplateAdminStatus = async (params?: GetTemplateAdminStatusParams, options?: RequestInit): Promise<{
    data: TemplateAdminStatus;
}> =>{
    const res = await fetch("/api/constants/template-admin-status", {
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
export const getTemplateAdminStatusKey = (params?: GetTemplateAdminStatusParams)=>{
    return [
        "/api/constants/template-admin-status",
        params
    ] as const;
};
export function useGetTemplateAdminStatus<TData = {
    data: TemplateAdminStatus;
}>(options?: {
    params?: GetTemplateAdminStatusParams;
    query?: Omit<UseQueryOptions<{
        data: TemplateAdminStatus;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getTemplateAdminStatusKey(options?.params),
        queryFn: ()=>getTemplateAdminStatus(options?.params),
        ...options?.query
    });
}
export function useGetTemplateAdminStatusSuspense<TData = {
    data: TemplateAdminStatus;
}>(options?: {
    params?: GetTemplateAdminStatusParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: TemplateAdminStatus;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getTemplateAdminStatusKey(options?.params),
        queryFn: ()=>getTemplateAdminStatus(options?.params),
        ...options?.query
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
export interface InvokeAgentParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const invokeAgent = async (data: InvokeAgentRequest, params?: InvokeAgentParams, options?: RequestInit): Promise<{
    data: InvokeAgentResponse;
}> =>{
    const res = await fetch("/api/invoke_agent", {
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
export function useInvokeAgent(options?: {
    mutation?: UseMutationOptions<{
        data: InvokeAgentResponse;
    }, ApiError, {
        params: InvokeAgentParams;
        data: InvokeAgentRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>invokeAgent(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface ListProjectsParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listProjects = async (params?: ListProjectsParams, options?: RequestInit): Promise<{
    data: ProjectListItem[];
}> =>{
    const res = await fetch("/api/projects", {
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
export const listProjectsKey = (params?: ListProjectsParams)=>{
    return [
        "/api/projects",
        params
    ] as const;
};
export function useListProjects<TData = {
    data: ProjectListItem[];
}>(options?: {
    params?: ListProjectsParams;
    query?: Omit<UseQueryOptions<{
        data: ProjectListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listProjectsKey(options?.params),
        queryFn: ()=>listProjects(options?.params),
        ...options?.query
    });
}
export function useListProjectsSuspense<TData = {
    data: ProjectListItem[];
}>(options?: {
    params?: ListProjectsParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ProjectListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listProjectsKey(options?.params),
        queryFn: ()=>listProjects(options?.params),
        ...options?.query
    });
}
export interface CreateProjectParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const createProject = async (data: ProjectCreateRequest, params?: CreateProjectParams, options?: RequestInit): Promise<{
    data: ProjectOut;
}> =>{
    const res = await fetch("/api/projects", {
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
export function useCreateProject(options?: {
    mutation?: UseMutationOptions<{
        data: ProjectOut;
    }, ApiError, {
        params: CreateProjectParams;
        data: ProjectCreateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>createProject(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface GetProjectParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getProject = async (params: GetProjectParams, options?: RequestInit): Promise<{
    data: ProjectOut;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}`, {
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
export const getProjectKey = (params?: GetProjectParams)=>{
    return [
        "/api/projects/{project_id}",
        params
    ] as const;
};
export function useGetProject<TData = {
    data: ProjectOut;
}>(options: {
    params: GetProjectParams;
    query?: Omit<UseQueryOptions<{
        data: ProjectOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getProjectKey(options.params),
        queryFn: ()=>getProject(options.params),
        ...options?.query
    });
}
export function useGetProjectSuspense<TData = {
    data: ProjectOut;
}>(options: {
    params: GetProjectParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ProjectOut;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getProjectKey(options.params),
        queryFn: ()=>getProject(options.params),
        ...options?.query
    });
}
export interface UpdateProjectParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const updateProject = async (params: UpdateProjectParams, data: ProjectUpdateRequest, options?: RequestInit): Promise<{
    data: ProjectOut;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}`, {
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
export function useUpdateProject(options?: {
    mutation?: UseMutationOptions<{
        data: ProjectOut;
    }, ApiError, {
        params: UpdateProjectParams;
        data: ProjectUpdateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>updateProject(vars.params, vars.data),
        ...options?.mutation
    });
}
export interface DeleteProjectParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const deleteProject = async (params: DeleteProjectParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}`, {
        ...options,
        method: "DELETE",
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
export function useDeleteProject(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: DeleteProjectParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>deleteProject(vars.params),
        ...options?.mutation
    });
}
export interface GetActiveExecutionParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getActiveExecution = async (params: GetActiveExecutionParams, options?: RequestInit): Promise<{
    data: ActiveExecutionOut | null;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/execution`, {
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
export const getActiveExecutionKey = (params?: GetActiveExecutionParams)=>{
    return [
        "/api/projects/{project_id}/execution",
        params
    ] as const;
};
export function useGetActiveExecution<TData = {
    data: ActiveExecutionOut | null;
}>(options: {
    params: GetActiveExecutionParams;
    query?: Omit<UseQueryOptions<{
        data: ActiveExecutionOut | null;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getActiveExecutionKey(options.params),
        queryFn: ()=>getActiveExecution(options.params),
        ...options?.query
    });
}
export function useGetActiveExecutionSuspense<TData = {
    data: ActiveExecutionOut | null;
}>(options: {
    params: GetActiveExecutionParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ActiveExecutionOut | null;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getActiveExecutionKey(options.params),
        queryFn: ()=>getActiveExecution(options.params),
        ...options?.query
    });
}
export interface ListProjectFilesParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listProjectFiles = async (params: ListProjectFilesParams, options?: RequestInit): Promise<{
    data: ProjectFileOut[];
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/files`, {
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
export const listProjectFilesKey = (params?: ListProjectFilesParams)=>{
    return [
        "/api/projects/{project_id}/files",
        params
    ] as const;
};
export function useListProjectFiles<TData = {
    data: ProjectFileOut[];
}>(options: {
    params: ListProjectFilesParams;
    query?: Omit<UseQueryOptions<{
        data: ProjectFileOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listProjectFilesKey(options.params),
        queryFn: ()=>listProjectFiles(options.params),
        ...options?.query
    });
}
export function useListProjectFilesSuspense<TData = {
    data: ProjectFileOut[];
}>(options: {
    params: ListProjectFilesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ProjectFileOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listProjectFilesKey(options.params),
        queryFn: ()=>listProjectFiles(options.params),
        ...options?.query
    });
}
export interface GetProjectFileParams {
    project_id: string;
    file_path: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getProjectFile = async (params: GetProjectFileParams, options?: RequestInit): Promise<{
    data: ProjectFileContent;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/files/${params.file_path}`, {
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
export const getProjectFileKey = (params?: GetProjectFileParams)=>{
    return [
        "/api/projects/{project_id}/files/{file_path}",
        params
    ] as const;
};
export function useGetProjectFile<TData = {
    data: ProjectFileContent;
}>(options: {
    params: GetProjectFileParams;
    query?: Omit<UseQueryOptions<{
        data: ProjectFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getProjectFileKey(options.params),
        queryFn: ()=>getProjectFile(options.params),
        ...options?.query
    });
}
export function useGetProjectFileSuspense<TData = {
    data: ProjectFileContent;
}>(options: {
    params: GetProjectFileParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ProjectFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getProjectFileKey(options.params),
        queryFn: ()=>getProjectFile(options.params),
        ...options?.query
    });
}
export interface ListProjectMessagesParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listProjectMessages = async (params: ListProjectMessagesParams, options?: RequestInit): Promise<{
    data: MessageOut[];
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/messages`, {
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
export const listProjectMessagesKey = (params?: ListProjectMessagesParams)=>{
    return [
        "/api/projects/{project_id}/messages",
        params
    ] as const;
};
export function useListProjectMessages<TData = {
    data: MessageOut[];
}>(options: {
    params: ListProjectMessagesParams;
    query?: Omit<UseQueryOptions<{
        data: MessageOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listProjectMessagesKey(options.params),
        queryFn: ()=>listProjectMessages(options.params),
        ...options?.query
    });
}
export function useListProjectMessagesSuspense<TData = {
    data: MessageOut[];
}>(options: {
    params: ListProjectMessagesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: MessageOut[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listProjectMessagesKey(options.params),
        queryFn: ()=>listProjectMessages(options.params),
        ...options?.query
    });
}
export interface AddProjectMessageParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const addProjectMessage = async (params: AddProjectMessageParams, data: MessageCreateRequest, options?: RequestInit): Promise<{
    data: MessageOut;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/messages`, {
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
export function useAddProjectMessage(options?: {
    mutation?: UseMutationOptions<{
        data: MessageOut;
    }, ApiError, {
        params: AddProjectMessageParams;
        data: MessageCreateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>addProjectMessage(vars.params, vars.data),
        ...options?.mutation
    });
}
export interface ClearProjectMessagesParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const clearProjectMessages = async (params: ClearProjectMessagesParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/messages`, {
        ...options,
        method: "DELETE",
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
export function useClearProjectMessages(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: ClearProjectMessagesParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>clearProjectMessages(vars.params),
        ...options?.mutation
    });
}
export interface UpdateProjectResourcesParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const updateProjectResources = async (params: UpdateProjectResourcesParams, data: ProjectResourcesUpdateRequest, options?: RequestInit): Promise<{
    data: ProjectOut;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/resources`, {
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
export function useUpdateProjectResources(options?: {
    mutation?: UseMutationOptions<{
        data: ProjectOut;
    }, ApiError, {
        params: UpdateProjectResourcesParams;
        data: ProjectResourcesUpdateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>updateProjectResources(vars.params, vars.data),
        ...options?.mutation
    });
}
export interface ClearProjectSessionParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const clearProjectSession = async (params: ClearProjectSessionParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/session/clear`, {
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
export function useClearProjectSession(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: ClearProjectSessionParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>clearProjectSession(vars.params),
        ...options?.mutation
    });
}
export interface GetProjectSkillsParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getProjectSkills = async (params: GetProjectSkillsParams, options?: RequestInit): Promise<{
    data: SkillInfo[];
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/skills`, {
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
export const getProjectSkillsKey = (params?: GetProjectSkillsParams)=>{
    return [
        "/api/projects/{project_id}/skills",
        params
    ] as const;
};
export function useGetProjectSkills<TData = {
    data: SkillInfo[];
}>(options: {
    params: GetProjectSkillsParams;
    query?: Omit<UseQueryOptions<{
        data: SkillInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getProjectSkillsKey(options.params),
        queryFn: ()=>getProjectSkills(options.params),
        ...options?.query
    });
}
export function useGetProjectSkillsSuspense<TData = {
    data: SkillInfo[];
}>(options: {
    params: GetProjectSkillsParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: SkillInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getProjectSkillsKey(options.params),
        queryFn: ()=>getProjectSkills(options.params),
        ...options?.query
    });
}
export interface RefreshProjectSkillsParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const refreshProjectSkills = async (params: RefreshProjectSkillsParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/skills/refresh`, {
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
export function useRefreshProjectSkills(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: RefreshProjectSkillsParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>refreshProjectSkills(vars.params),
        ...options?.mutation
    });
}
export interface GetSkillFilesParams {
    project_id: string;
    skill_name: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getSkillFiles = async (params: GetSkillFilesParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/skills/${params.skill_name}/files`, {
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
export const getSkillFilesKey = (params?: GetSkillFilesParams)=>{
    return [
        "/api/projects/{project_id}/skills/{skill_name}/files",
        params
    ] as const;
};
export function useGetSkillFiles<TData = {
    data: unknown;
}>(options: {
    params: GetSkillFilesParams;
    query?: Omit<UseQueryOptions<{
        data: unknown;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getSkillFilesKey(options.params),
        queryFn: ()=>getSkillFiles(options.params),
        ...options?.query
    });
}
export function useGetSkillFilesSuspense<TData = {
    data: unknown;
}>(options: {
    params: GetSkillFilesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: unknown;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getSkillFilesKey(options.params),
        queryFn: ()=>getSkillFiles(options.params),
        ...options?.query
    });
}
export interface GetSkillFileContentParams {
    project_id: string;
    skill_name: string;
    file_path: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getSkillFileContent = async (params: GetSkillFileContentParams, options?: RequestInit): Promise<{
    data: SkillFileContent;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/skills/${params.skill_name}/files/${params.file_path}`, {
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
export const getSkillFileContentKey = (params?: GetSkillFileContentParams)=>{
    return [
        "/api/projects/{project_id}/skills/{skill_name}/files/{file_path}",
        params
    ] as const;
};
export function useGetSkillFileContent<TData = {
    data: SkillFileContent;
}>(options: {
    params: GetSkillFileContentParams;
    query?: Omit<UseQueryOptions<{
        data: SkillFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getSkillFileContentKey(options.params),
        queryFn: ()=>getSkillFileContent(options.params),
        ...options?.query
    });
}
export function useGetSkillFileContentSuspense<TData = {
    data: SkillFileContent;
}>(options: {
    params: GetSkillFileContentParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: SkillFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getSkillFileContentKey(options.params),
        queryFn: ()=>getSkillFileContent(options.params),
        ...options?.query
    });
}
export interface SyncProjectParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const syncProject = async (params: SyncProjectParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/sync`, {
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
export function useSyncProject(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: SyncProjectParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>syncProject(vars.params),
        ...options?.mutation
    });
}
export interface GetProjectSystemPromptParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getProjectSystemPrompt = async (params: GetProjectSystemPromptParams, options?: RequestInit): Promise<{
    data: SystemPromptResponse;
}> =>{
    const res = await fetch(`/api/projects/${params.project_id}/system-prompt`, {
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
export const getProjectSystemPromptKey = (params?: GetProjectSystemPromptParams)=>{
    return [
        "/api/projects/{project_id}/system-prompt",
        params
    ] as const;
};
export function useGetProjectSystemPrompt<TData = {
    data: SystemPromptResponse;
}>(options: {
    params: GetProjectSystemPromptParams;
    query?: Omit<UseQueryOptions<{
        data: SystemPromptResponse;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getProjectSystemPromptKey(options.params),
        queryFn: ()=>getProjectSystemPrompt(options.params),
        ...options?.query
    });
}
export function useGetProjectSystemPromptSuspense<TData = {
    data: SystemPromptResponse;
}>(options: {
    params: GetProjectSystemPromptParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: SystemPromptResponse;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getProjectSystemPromptKey(options.params),
        queryFn: ()=>getProjectSystemPrompt(options.params),
        ...options?.query
    });
}
export interface ListCatalogsParams {
    q?: string | null;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listCatalogs = async (params?: ListCatalogsParams, options?: RequestInit): Promise<{
    data: string[];
}> =>{
    const searchParams = new URLSearchParams();
    if (params?.q != null) searchParams.set("q", String(params?.q));
    const queryString = searchParams.toString();
    const url = queryString ? `/api/resources/catalogs?${queryString}` : "/api/resources/catalogs";
    const res = await fetch(url, {
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
export const listCatalogsKey = (params?: ListCatalogsParams)=>{
    return [
        "/api/resources/catalogs",
        params
    ] as const;
};
export function useListCatalogs<TData = {
    data: string[];
}>(options?: {
    params?: ListCatalogsParams;
    query?: Omit<UseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listCatalogsKey(options?.params),
        queryFn: ()=>listCatalogs(options?.params),
        ...options?.query
    });
}
export function useListCatalogsSuspense<TData = {
    data: string[];
}>(options?: {
    params?: ListCatalogsParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listCatalogsKey(options?.params),
        queryFn: ()=>listCatalogs(options?.params),
        ...options?.query
    });
}
export interface ListClustersParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listClusters = async (params?: ListClustersParams, options?: RequestInit): Promise<{
    data: ClusterInfo[];
}> =>{
    const res = await fetch("/api/resources/clusters", {
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
export const listClustersKey = (params?: ListClustersParams)=>{
    return [
        "/api/resources/clusters",
        params
    ] as const;
};
export function useListClusters<TData = {
    data: ClusterInfo[];
}>(options?: {
    params?: ListClustersParams;
    query?: Omit<UseQueryOptions<{
        data: ClusterInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listClustersKey(options?.params),
        queryFn: ()=>listClusters(options?.params),
        ...options?.query
    });
}
export function useListClustersSuspense<TData = {
    data: ClusterInfo[];
}>(options?: {
    params?: ListClustersParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: ClusterInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listClustersKey(options?.params),
        queryFn: ()=>listClusters(options?.params),
        ...options?.query
    });
}
export const getResourceDefaults = async (options?: RequestInit): Promise<{
    data: ResourceDefaults;
}> =>{
    const res = await fetch("/api/resources/defaults", {
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
export const getResourceDefaultsKey = ()=>{
    return [
        "/api/resources/defaults"
    ] as const;
};
export function useGetResourceDefaults<TData = {
    data: ResourceDefaults;
}>(options?: {
    query?: Omit<UseQueryOptions<{
        data: ResourceDefaults;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getResourceDefaultsKey(),
        queryFn: ()=>getResourceDefaults(),
        ...options?.query
    });
}
export function useGetResourceDefaultsSuspense<TData = {
    data: ResourceDefaults;
}>(options?: {
    query?: Omit<UseSuspenseQueryOptions<{
        data: ResourceDefaults;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getResourceDefaultsKey(),
        queryFn: ()=>getResourceDefaults(),
        ...options?.query
    });
}
export interface RefreshResourcesParams {
    resource_type?: string | null;
    catalog?: string | null;
}
export const refreshResources = async (params?: RefreshResourcesParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const searchParams = new URLSearchParams();
    if (params?.resource_type != null) searchParams.set("resource_type", String(params?.resource_type));
    if (params?.catalog != null) searchParams.set("catalog", String(params?.catalog));
    const queryString = searchParams.toString();
    const url = queryString ? `/api/resources/refresh?${queryString}` : "/api/resources/refresh";
    const res = await fetch(url, {
        ...options,
        method: "POST"
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
export function useRefreshResources(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: RefreshResourcesParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>refreshResources(vars.params),
        ...options?.mutation
    });
}
export interface ListSchemasParams {
    catalog: string;
    q?: string | null;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listSchemas = async (params: ListSchemasParams, options?: RequestInit): Promise<{
    data: string[];
}> =>{
    const searchParams = new URLSearchParams();
    if (params.catalog != null) searchParams.set("catalog", String(params.catalog));
    if (params?.q != null) searchParams.set("q", String(params?.q));
    const queryString = searchParams.toString();
    const url = queryString ? `/api/resources/schemas?${queryString}` : "/api/resources/schemas";
    const res = await fetch(url, {
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
export const listSchemasKey = (params?: ListSchemasParams)=>{
    return [
        "/api/resources/schemas",
        params
    ] as const;
};
export function useListSchemas<TData = {
    data: string[];
}>(options: {
    params: ListSchemasParams;
    query?: Omit<UseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listSchemasKey(options.params),
        queryFn: ()=>listSchemas(options.params),
        ...options?.query
    });
}
export function useListSchemasSuspense<TData = {
    data: string[];
}>(options: {
    params: ListSchemasParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: string[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listSchemasKey(options.params),
        queryFn: ()=>listSchemas(options.params),
        ...options?.query
    });
}
export interface ListWarehousesParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listWarehouses = async (params?: ListWarehousesParams, options?: RequestInit): Promise<{
    data: WarehouseInfo[];
}> =>{
    const res = await fetch("/api/resources/warehouses", {
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
export const listWarehousesKey = (params?: ListWarehousesParams)=>{
    return [
        "/api/resources/warehouses",
        params
    ] as const;
};
export function useListWarehouses<TData = {
    data: WarehouseInfo[];
}>(options?: {
    params?: ListWarehousesParams;
    query?: Omit<UseQueryOptions<{
        data: WarehouseInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listWarehousesKey(options?.params),
        queryFn: ()=>listWarehouses(options?.params),
        ...options?.query
    });
}
export function useListWarehousesSuspense<TData = {
    data: WarehouseInfo[];
}>(options?: {
    params?: ListWarehousesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: WarehouseInfo[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listWarehousesKey(options?.params),
        queryFn: ()=>listWarehouses(options?.params),
        ...options?.query
    });
}
export interface StopStreamParams {
    execution_id: string;
}
export const stopStream = async (params: StopStreamParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/stop_stream/${params.execution_id}`, {
        ...options,
        method: "POST"
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
export function useStopStream(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: StopStreamParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>stopStream(vars.params),
        ...options?.mutation
    });
}
export interface StreamProgressParams {
    execution_id: string;
}
export const streamProgress = async (params: StreamProgressParams, data: StreamProgressRequest, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/stream_progress/${params.execution_id}`, {
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
export function useStreamProgress(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: StreamProgressParams;
        data: StreamProgressRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>streamProgress(vars.params, vars.data),
        ...options?.mutation
    });
}
export interface ListTemplatesParams {
    status?: string | null;
    industry?: string | null;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listTemplates = async (params?: ListTemplatesParams, options?: RequestInit): Promise<{
    data: TemplateListItem[];
}> =>{
    const searchParams = new URLSearchParams();
    if (params?.status != null) searchParams.set("status", String(params?.status));
    if (params?.industry != null) searchParams.set("industry", String(params?.industry));
    const queryString = searchParams.toString();
    const url = queryString ? `/api/templates?${queryString}` : "/api/templates";
    const res = await fetch(url, {
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
export const listTemplatesKey = (params?: ListTemplatesParams)=>{
    return [
        "/api/templates",
        params
    ] as const;
};
export function useListTemplates<TData = {
    data: TemplateListItem[];
}>(options?: {
    params?: ListTemplatesParams;
    query?: Omit<UseQueryOptions<{
        data: TemplateListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listTemplatesKey(options?.params),
        queryFn: ()=>listTemplates(options?.params),
        ...options?.query
    });
}
export function useListTemplatesSuspense<TData = {
    data: TemplateListItem[];
}>(options?: {
    params?: ListTemplatesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: TemplateListItem[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listTemplatesKey(options?.params),
        queryFn: ()=>listTemplates(options?.params),
        ...options?.query
    });
}
export interface SubmitTemplateFromProjectParams {
    project_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const submitTemplateFromProject = async (params: SubmitTemplateFromProjectParams, options?: RequestInit): Promise<{
    data: TemplateListItem;
}> =>{
    const res = await fetch(`/api/templates/from-project/${params.project_id}`, {
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
export function useSubmitTemplateFromProject(options?: {
    mutation?: UseMutationOptions<{
        data: TemplateListItem;
    }, ApiError, {
        params: SubmitTemplateFromProjectParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>submitTemplateFromProject(vars.params),
        ...options?.mutation
    });
}
export interface SearchTemplatesParams {
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const searchTemplates = async (data: SearchTemplatesRequest, params?: SearchTemplatesParams, options?: RequestInit): Promise<{
    data: TemplateSearchResult[];
}> =>{
    const res = await fetch("/api/templates/search", {
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
export function useSearchTemplates(options?: {
    mutation?: UseMutationOptions<{
        data: TemplateSearchResult[];
    }, ApiError, {
        params: SearchTemplatesParams;
        data: SearchTemplatesRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>searchTemplates(vars.data, vars.params),
        ...options?.mutation
    });
}
export interface GetTemplateParams {
    template_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getTemplate = async (params: GetTemplateParams, options?: RequestInit): Promise<{
    data: TemplateDetail;
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}`, {
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
export const getTemplateKey = (params?: GetTemplateParams)=>{
    return [
        "/api/templates/{template_id}",
        params
    ] as const;
};
export function useGetTemplate<TData = {
    data: TemplateDetail;
}>(options: {
    params: GetTemplateParams;
    query?: Omit<UseQueryOptions<{
        data: TemplateDetail;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getTemplateKey(options.params),
        queryFn: ()=>getTemplate(options.params),
        ...options?.query
    });
}
export function useGetTemplateSuspense<TData = {
    data: TemplateDetail;
}>(options: {
    params: GetTemplateParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: TemplateDetail;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getTemplateKey(options.params),
        queryFn: ()=>getTemplate(options.params),
        ...options?.query
    });
}
export interface DeleteTemplateParams {
    template_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const deleteTemplate = async (params: DeleteTemplateParams, options?: RequestInit): Promise<{
    data: unknown;
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}`, {
        ...options,
        method: "DELETE",
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
export function useDeleteTemplate(options?: {
    mutation?: UseMutationOptions<{
        data: unknown;
    }, ApiError, {
        params: DeleteTemplateParams;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>deleteTemplate(vars.params),
        ...options?.mutation
    });
}
export interface CreateProjectFromTemplateParams {
    template_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const createProjectFromTemplate = async (params: CreateProjectFromTemplateParams, data: CreateProjectFromTemplateRequest, options?: RequestInit): Promise<{
    data: ProjectOut;
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}/create-project`, {
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
export function useCreateProjectFromTemplate(options?: {
    mutation?: UseMutationOptions<{
        data: ProjectOut;
    }, ApiError, {
        params: CreateProjectFromTemplateParams;
        data: CreateProjectFromTemplateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>createProjectFromTemplate(vars.params, vars.data),
        ...options?.mutation
    });
}
export interface ListTemplateFilesParams {
    template_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const listTemplateFiles = async (params: ListTemplateFilesParams, options?: RequestInit): Promise<{
    data: TemplateFile[];
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}/files`, {
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
export const listTemplateFilesKey = (params?: ListTemplateFilesParams)=>{
    return [
        "/api/templates/{template_id}/files",
        params
    ] as const;
};
export function useListTemplateFiles<TData = {
    data: TemplateFile[];
}>(options: {
    params: ListTemplateFilesParams;
    query?: Omit<UseQueryOptions<{
        data: TemplateFile[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: listTemplateFilesKey(options.params),
        queryFn: ()=>listTemplateFiles(options.params),
        ...options?.query
    });
}
export function useListTemplateFilesSuspense<TData = {
    data: TemplateFile[];
}>(options: {
    params: ListTemplateFilesParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: TemplateFile[];
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: listTemplateFilesKey(options.params),
        queryFn: ()=>listTemplateFiles(options.params),
        ...options?.query
    });
}
export interface GetTemplateFileContentParams {
    template_id: string;
    file_path: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const getTemplateFileContent = async (params: GetTemplateFileContentParams, options?: RequestInit): Promise<{
    data: TemplateFileContent;
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}/files/${params.file_path}`, {
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
export const getTemplateFileContentKey = (params?: GetTemplateFileContentParams)=>{
    return [
        "/api/templates/{template_id}/files/{file_path}",
        params
    ] as const;
};
export function useGetTemplateFileContent<TData = {
    data: TemplateFileContent;
}>(options: {
    params: GetTemplateFileContentParams;
    query?: Omit<UseQueryOptions<{
        data: TemplateFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useQuery({
        queryKey: getTemplateFileContentKey(options.params),
        queryFn: ()=>getTemplateFileContent(options.params),
        ...options?.query
    });
}
export function useGetTemplateFileContentSuspense<TData = {
    data: TemplateFileContent;
}>(options: {
    params: GetTemplateFileContentParams;
    query?: Omit<UseSuspenseQueryOptions<{
        data: TemplateFileContent;
    }, ApiError, TData>, "queryKey" | "queryFn">;
}) {
    return useSuspenseQuery({
        queryKey: getTemplateFileContentKey(options.params),
        queryFn: ()=>getTemplateFileContent(options.params),
        ...options?.query
    });
}
export interface UpdateTemplateStatusParams {
    template_id: string;
    "X-Forwarded-Host"?: string | null;
    "X-Forwarded-Preferred-Username"?: string | null;
    "X-Forwarded-User"?: string | null;
    "X-Forwarded-Email"?: string | null;
    "X-Request-Id"?: string | null;
    "X-Forwarded-Access-Token"?: string | null;
}
export const updateTemplateStatus = async (params: UpdateTemplateStatusParams, data: TemplateStatusUpdateRequest, options?: RequestInit): Promise<{
    data: TemplateListItem;
}> =>{
    const res = await fetch(`/api/templates/${params.template_id}/status`, {
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
export function useUpdateTemplateStatus(options?: {
    mutation?: UseMutationOptions<{
        data: TemplateListItem;
    }, ApiError, {
        params: UpdateTemplateStatusParams;
        data: TemplateStatusUpdateRequest;
    }>;
}) {
    return useMutation({
        mutationFn: (vars)=>updateTemplateStatus(vars.params, vars.data),
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
