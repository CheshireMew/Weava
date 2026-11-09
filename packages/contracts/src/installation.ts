import * as z from 'zod';
export const featureIds = ['content','media','analytics','engagement'] as const;
export type FeatureId = typeof featureIds[number];
export const allFeatures: FeatureId[] = [...featureIds];
export const siteDescriptorSchema = z.object({
  version:z.literal(2),id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  port:z.number().int().min(1024).max(65535),features:z.array(z.enum(featureIds)),
  template:z.enum(['blog','company','portfolio','documentation','resource','blank','demo']).default('blank'),
  environment:z.record(z.string(),z.string()).optional(),
  upgrade:z.object({dynamicRedirects:z.array(z.object({path:z.string().regex(/^\/(?!\/)[^?#\\]*$/),status:z.union([z.literal(302),z.literal(307)]).default(302),contentType:z.string().min(1)})).default([])}).optional(),
});
export type SiteDescriptor = z.infer<typeof siteDescriptorSchema>;
export const deploymentSchema = z.object({
  version:z.literal(2),programId:z.string().min(1),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),
  siteBuildId:z.string().optional(),siteBuildHash:z.string().optional(),selectedAt:z.string(),installationRoot:z.string().min(1),
});
export type Deployment = z.infer<typeof deploymentSchema>;
export const staticRouteSchema = z.object({
  prefix:z.string().regex(/^\/(?!\/)[^?#\\]*\/$/).refine(value=>new URL(value,'http://localhost').pathname===value,'静态路径不能包含相对目录。'),
  directory:z.string().min(1),
});
export type StaticRoute = z.infer<typeof staticRouteSchema>;
export const installationSchema = z.object({
  version:z.literal(1),id:z.string(),node:z.string(),sitesRoot:z.string(),backupRoot:z.string(),
  defaultProgramId:z.string().optional(),
  programs:z.record(z.string(),z.object({root:z.string(),manifestHash:z.string()})),
  sites:z.record(z.string(),z.object({root:z.string(),autostart:z.boolean().default(false),proxyOrigin:z.url().optional(),staticRoutes:z.array(staticRouteSchema).optional()})),
});
export type Installation = z.infer<typeof installationSchema>;
export function validateFeatures(features:FeatureId[]) {
  const value=[...new Set(z.array(z.enum(featureIds)).parse(features))];
  if(value.includes('engagement')&&!value.includes('content'))throw new Error('互动功能需要先启用内容功能。');
  return value;
}

