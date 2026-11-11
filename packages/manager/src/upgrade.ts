import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { requestHost } from './host.ts';
import {
  adoptSite,
  checkWorkspace,
  onlineWorkspace,
  restoreCheckpoint,
  withLease,
} from './operations.ts';
import { probeServer } from './probe-server.ts';
import { maintenance, maintenanceProbeHeaders, prepareProxy, proxyDirectory, saveRobots } from './proxy.ts';
import { publicInventory, siteStamp } from './public-inventory.ts';
import { activationSnapshot, captureSeo, compareSeo, freshRobotsPath, upgradeProbePath, type SeoSnapshot } from './seo-check.ts';
import { checkService } from './service-check.ts';
import {
  atomic,
  deployment,
  descriptor,
  hash,
  inside,
  json,
  loadInstallation,
  programFor,
} from './state.ts';

export interface UpgradeOptions {
  check?: boolean;
  acceptSeo?: string;
}
/** Runtime/CLI maintenance changes do not require crawling unchanged public render code. */
export function publicProgramFingerprint(program: {manifest:any}) {
  return hash([program.manifest.schemaVersion,program.manifest.files
    .filter((file:any)=>file.path.startsWith('web/')||/^runtime\/site-(?:entry|build|public)\.mjs$/.test(file.path))
    .sort((a:any,b:any)=>a.path.localeCompare(b.path))]);
}
export async function withUpgradeLock<T>(root: string, action: () => Promise<T>) {
  const lock = new DatabaseSync(root + '.upgrade-access.sqlite');
  try {
    lock.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE');
  } catch (error) {
    lock.close();
    throw new Error('网站已有升级或 SEO 检查正在执行。');
  }
  try {
    return await action();
  } finally {
    lock.exec('ROLLBACK');
    lock.close();
  }
}
async function verifyMaintenance(origin: string, domain: string, baseline: SeoSnapshot, probe:Record<string,string>) {
  const headers = { Host: new URL(domain).host, 'User-Agent': 'WeavaUpgradeCheck' };
  const r = await fetch(origin + '/', { headers, signal: AbortSignal.timeout(10000) });
  await r.body?.cancel();
  if (
    r.status !== 503 ||
    !/^\d+$/.test(r.headers.get('retry-after') ?? '') ||
    !r.headers.get('cache-control')?.includes('no-store') ||
    r.headers.get('x-robots-tag')?.includes('noindex')
  )
    throw new Error(
      '反向代理未正确接入维护配置，旧站仍保持运行；请先应用 site deployment-info 输出的 include。',
    );
  const robots = await fetch(origin + freshRobotsPath(), {
      headers,
      signal: AbortSignal.timeout(10000),
    }),
    text = await robots.text();
  if (
    robots.status !== baseline.robots.status ||
    (robots.status === 200 && text !== baseline.robots.text)
  )
    throw new Error('维护期间 robots.txt 未保留原规则，已取消切换。');
  const accessible=await fetch(origin+'/',{headers:{...headers,...probe},signal:AbortSignal.timeout(10000)});
  await accessible.body?.cancel();
  if(accessible.status!==baseline.pages['/']?.status)throw new Error('反向代理未加载预检通道，请应用新版 site deployment-info 配置并重载代理；旧站未停止。');
}
export async function protectedUpgrade(
  home: string,
  root: string,
  id: string,
  programId: string | undefined,
  buildId: string | undefined,
  options: UpgradeOptions = {},
) {
  return withUpgradeLock(root, async () => {
    const installation = loadInstallation(home),
      config = descriptor(root),
      candidate = programFor(installation, programId),
      prior = deployment(root);
    const routing=installation.sites[id],routes=routing?.staticRoutes??[];
    if(routes.length&&!routing?.proxyOrigin)throw new Error('静态目录映射需要登记实际反向代理入口。');
    const routingHash=hash([routing?.proxyOrigin??null,routes]);
    const assertRouting=()=>{const current=loadInstallation(home).sites[id];if(hash([current?.proxyOrigin??null,current?.staticRoutes??[]])!==routingHash)throw new Error('部署入口或静态目录映射已变化，请重新预检。');};
    if (candidate.manifest.upgradeProtocol !== 2)
      throw new Error('候选程序不支持匿名 SEO 升级检查，请准备包含 upgradeProtocol 2 的新版程序。');
    buildId ??= prior.siteBuildId;
    let buildHash: string | undefined;
    if (buildId) {
      if (!/^[\w-]+$/.test(buildId)) throw new Error('网站构建编号无效。');
      const file = inside(join(root, 'site-builds'), buildId + '/site-build.json'),
        build = json(file);
      if (build.programId !== candidate.manifest.id)
        throw new Error('请先为目标程序准备配套网站构建。');
      buildHash = hash(readFileSync(file));
    }
    const journalFile = join(root, '.weava-update.json'),
      preparationFile = join(root, '.weava-preparation.json');
    if (existsSync(journalFile) && !['complete', 'rolled-back'].includes(json(journalFile).status))
      throw new Error('上一次升级尚未完成，请先执行 site recover。');
    if (existsSync(join(proxyDirectory(home, id), 'active.json')))
      throw new Error('网站有未解除的维护状态，请先执行 site recover。');
    const hostStatus = await requestHost(home, 'status');
    if (hostStatus.protocol !== 2)
      throw new Error('请先重启已更新的托管入口，再执行具备 SEO 检查的升级。');
    const wasRunning = hostStatus.sites.some(
      (s: any) => s.id === id && ['running', 'starting'].includes(s.status),
    );
    if (!options.check && wasRunning && prior.programId === candidate.manifest.id &&
        prior.manifestHash === candidate.manifestHash && prior.siteBuildId === buildId &&
        hostStatus.sites.some((s:any)=>s.id===id&&s.status==='running'&&s.programId===candidate.manifest.id)) {
      await checkService(root, { homepage:true, agent:'WeavaUpgradeCheck' });
      return { unchanged:true, verified:true, programId:candidate.manifest.id, oldSiteStopped:false,
        timings:{preparationMs:0,maintenanceMs:0} };
    }
    const operation = randomUUID(),
      started = Date.now();
    let work: string | undefined,
      stopped = false,
      marked = false,
      recorded = false,
      succeeded = false,
      writesEnabled = false,
      failure: unknown,
      result: Awaited<ReturnType<typeof adoptSite>> | undefined,
      maintenanceStarted = 0;
    try {
      if (!wasRunning) await requestHost(home, 'start', { id });
      const originalStamp = siteStamp(root),preflightFile=join(root,'.weava-preflight.json');
      let cached:any;
      if(options.acceptSeo&&existsSync(preflightFile)){
        try{
          const saved=json<any>(preflightFile);
          if(saved.approval===options.acceptSeo&&saved.stamp===originalStamp&&saved.target===candidate.manifestHash&&
              saved.buildHash===(buildHash??null)&&saved.routingHash===routingHash){
            const work=inside(join(installation.backupRoot,config.id),saved.work),before=json(join(work,'seo-before.json')),after=json(join(work,'seo-preflight.json'));
            if(siteStamp(work)===saved.workStamp&&hash([before,after,saved.rehearsal])===saved.outputHash)cached={...saved,before,after};
          }
        }catch{/* An unavailable or changed rehearsal is recomputed while the old site stays online. */}
      }
      const prepared:{root:string;stamp:string} = cached?{root:cached.work,stamp:originalStamp}:await onlineWorkspace(home, root, candidate, buildId, buildHash);
      work = prepared.root;
      if (prepared.stamp !== originalStamp || siteStamp(root) !== originalStamp)
        throw new Error('准备网站副本时资料发生变化，旧站继续运行，请重试。');
      const inventory = publicInventory(root),
        backend = 'http://127.0.0.1:' + config.port,
        origin = installation.sites[id]?.proxyOrigin ?? backend;
      const paths = [
        ...inventory.paths,
        upgradeProbePath(originalStamp, candidate.manifestHash, buildHash),
      ];
      const missingStatic=routes.map(route=>route.prefix+upgradeProbePath(originalStamp,candidate.manifestHash,buildHash).slice(1)+'.png');
      paths.push(...missingStatic);
      const priorProgram=programFor(installation,prior.programId,false);
      const unchangedRendering=!options.check&&prior.siteBuildId===buildId&&
        publicProgramFingerprint(priorProgram)===publicProgramFingerprint(candidate);
      const criticalPaths=[...(inventory.criticalPaths??inventory.paths),...inventory.redirects,
        ...Object.keys(inventory.dynamicRedirects),...paths.filter(path=>path.includes('__weava_upgrade_missing_'))];
      const discovery=unchangedRendering?'selected' as const:undefined;
      const baseline:SeoSnapshot = cached?.before??await captureSeo({
        origin,
        freshRobots: !!routing?.proxyOrigin,
        routes:routes.map(route=>({prefix:route.prefix,origin})),
        domain: inventory.domain,
        paths:unchangedRendering?criticalPaths:paths,
        discovery,
        redirects: inventory.redirects,
        dynamicRedirects: inventory.dynamicRedirects,
      });
      atomic(join(work, 'seo-before.json'), baseline);
      if (siteStamp(root) !== originalStamp)
        throw new Error('采集公开页面时网站资料发生变化，旧站继续运行，请重试。');
      const rehearsal = cached?.rehearsal??await checkWorkspace(home, root, work, candidate);
      let after:SeoSnapshot=cached?.after;
      if(!cached){
      const probe = await probeServer(installation.node, candidate, work, config.environment, {
        WEAVA_INSTALLATION: home,
        WEAVA_SITE_ID: id,
        WEAVA_RESOURCE_ROOT: root,
        WEAVA_SITE_BUILDS_ROOT: join(root, 'site-builds'),
      });
      try {
        after = await captureSeo({
          origin: probe.origin,
          domain: inventory.domain,
          paths:unchangedRendering?criticalPaths:paths,
          discovery,
          redirects: inventory.redirects,
          dynamicRedirects: inventory.dynamicRedirects,
          headers: probe.headers,
          routes:routes.map(route=>({prefix:route.prefix,origin})),
          seed: baseline,
        });
      } finally {
        await probe.stop();
      }
      }
      atomic(join(work, 'seo-preflight.json'), after);
      const report = compareSeo(baseline, after),
        approval = hash(
          JSON.stringify({
            stamp: originalStamp,
            target: candidate.manifestHash,
            buildHash,
            domain: inventory.domain,
            routingHash,
            differences: report.differences,
          }),
        );
      const reportFile = join(work, 'seo-report.json');
      atomic(reportFile, { ...report, approval, operation, stage: 'preflight' });
      atomic(preflightFile,{version:1,work,stamp:originalStamp,target:candidate.manifestHash,buildHash:buildHash??null,routingHash,
        approval,rehearsal,workStamp:siteStamp(work),outputHash:hash([baseline,after,rehearsal])});
      if (!report.passed && options.acceptSeo !== approval)
        throw Object.assign(new Error('SEO 对比未通过，尚未停止旧站。报告：' + reportFile), {
          details: { report: reportFile, approval, differences: report.differences.length },
        });
      if (siteStamp(root) !== originalStamp)
        throw new Error('演练期间网站资料发生变化，旧站继续运行，请重新执行检查。');
      // Rehearsal reports belong to their workspace. Only an actual switch owns
      // the site's recovery record, including when a previous upgrade completed.
      if (options.check)
        return {
          checked: true,
          passed: report.passed,
          accepted: !report.passed,
          report: reportFile,
          approval,
          oldSiteStopped: false,
        };
      assertRouting();
      prepareProxy(home, id, config.port,routes);
      const proxyProbe=maintenanceProbeHeaders(home,id);
      saveRobots(home, id, baseline.robots.status, baseline.robots.text);
      atomic(preparationFile, {
        version: 1,
        operation,
        status: 'maintenance',
        work,
        stamp: originalStamp,
        prior,
        wasRunning,
        report: reportFile,
      });
      recorded = true;
      maintenance(home, id, true, operation);
      marked = true;
      maintenanceStarted = Date.now();
      if (installation.sites[id]?.proxyOrigin)
        await verifyMaintenance(origin, inventory.domain, baseline,proxyProbe);
      await requestHost(home, 'stop', { id });
      stopped = true;
      atomic(preparationFile, {
        version: 1,
        operation,
        status: 'stopped',
        work,
        stamp: originalStamp,
        prior,
        wasRunning,
      });
      result = await adoptSite(home, root, id, candidate.manifest.id, buildId, {
        stamp: originalStamp,
        rehearsal,
        work,
        operation,
      });
      const token = randomBytes(32).toString('hex');
      await requestHost(home, 'start', { id, validation: true, probeToken: token });
      await requestHost(home, 'initialize', { id });
      const expected = activationSnapshot(after,criticalPaths,routes.map(route=>route.prefix));
      const actualStamp = siteStamp(root),
        actual = await captureSeo({
          origin,
          freshRobots: !!routing?.proxyOrigin,
          routes:routes.map(route=>({prefix:route.prefix,origin})),
          domain: inventory.domain,
          paths:Object.keys(expected.pages),
          redirects: inventory.redirects,
          dynamicRedirects: inventory.dynamicRedirects,
          headers: { 'x-weava-upgrade-probe': token,...(routing?.proxyOrigin?proxyProbe:{}) },
          seed: expected,
          discovery:'selected',
        });
      atomic(join(work, 'seo-after.json'), actual);
      const final = compareSeo(expected, actual);
      atomic(join(work, 'seo-final-report.json'), { ...final, operation, stage: routing?.proxyOrigin?'public-proxy':'actual-service',origin });
      if (!final.passed)
        throw new Error(
          '实际网站的 SEO 输出与已演练结果不同，正在恢复。报告：' +
            join(work, 'seo-final-report.json'),
        );
      if (siteStamp(root) !== actualStamp)
        throw new Error('升级检查期间出现意外数据写入，正在恢复。');
      assertRouting();
      await checkService(root, { agent: 'WeavaUpgradeCheck' });
      // Persist the irreversible boundary before sending an activation whose reply may be lost.
      atomic(journalFile, {
        ...json<any>(journalFile),
        status: 'activating',
        writesEnabled: true,
        activationProbe: { origin, domain: inventory.domain, status: baseline.pages['/']?.status },
      });
      writesEnabled = true;
      await requestHost(home, 'activate', { id });
      const journal = json(journalFile);
      atomic(journalFile, {
        ...journal,
        status: 'complete',
        seo: {
          report: join(work, 'seo-final-report.json'),
          approval: report.passed ? null : approval,
        },
        completedAt: new Date().toISOString(),
      });
      maintenance(home, id, false, operation);
      marked = false;
      if (installation.sites[id]?.proxyOrigin) {
        const response = await fetch(origin + '/', {
          headers: { Host: new URL(inventory.domain).host },
          signal: AbortSignal.timeout(15000),
        });
        await response.body?.cancel();
        if (response.status !== baseline.pages['/']?.status)
          throw new Error('反向代理恢复访问后检查失败。');
      }
      const timings = {
        preparationMs: maintenanceStarted - started,
        maintenanceMs: Date.now() - maintenanceStarted,
      };
      atomic(preparationFile, { version: 1, operation, status: 'complete', work, timings });
      succeeded = true;
      return {
        ...result,
        verified: true,
        seo: { ...final, accepted: !report.passed, preflight:reportFile, report: join(work, 'seo-final-report.json'),
          scope:unchangedRendering?'unchanged-rendering':'full-output',preflightPages:Object.keys(after.pages).length,activationPages:Object.keys(actual.pages).length },
        proxyVerified: !!installation.sites[id]?.proxyOrigin,
        reusedPreflight:!!cached,
        timings,
      };
    } catch (error) {
      failure = error;
      if (writesEnabled) {
        if (!marked) {
          maintenance(home, id, true, operation);
          marked = true;
        }
        atomic(journalFile, {
          ...json<any>(journalFile),
          status: 'activation-failed',
          writesEnabled: true,
          error: String(error),
        });
        atomic(preparationFile, {
          version: 1,
          operation,
          status: 'activation-failed',
          writesEnabled: true,
          work,
          prior,
          wasRunning,
          error: String(error),
        });
        throw new Error(
          String(error) +
            '；新版本可能已接收写入，当前数据已保留。请执行 site recover 检查并恢复服务。',
        );
      }
      let recovered = !stopped;
      if (stopped) {
        try {
          if (!marked) {
            maintenance(home, id, true, operation);
            marked = true;
          }
          await requestHost(home, 'stop', { id });
          if (result)
            await withLease(home, root, candidate, async () => {
              restoreCheckpoint(result!.point, root);
              atomic(journalFile, {
                ...json<any>(journalFile),
                status: 'rolled-back',
                error: String(error),
              });
            });
          else if (
            existsSync(journalFile) &&
            json(journalFile).status !== 'rolled-back' &&
            json(journalFile).online?.operation === operation
          )
            throw new Error('迁移恢复尚未完成，请执行 site recover。');
          await requestHost(home, 'start', { id });
          await checkService(root, { agent: 'WeavaUpgradeCheck' });
          recovered = true;
        } catch (recoveryError) {
          atomic(preparationFile, {
            version: 1,
            operation,
            status: 'recovery-required',
            work,
            error: String(error),
            recoveryError: String(recoveryError),
          });
          failure = new Error(
            String(error) + '；恢复未完成，维护响应已保留：' + String(recoveryError),
          );
          throw failure;
        }
      }
      if (marked && recovered) maintenance(home, id, false, operation);
      if (recorded)
        atomic(preparationFile, {
          version: 1,
          operation,
          status: stopped ? 'rolled-back' : 'preflight-failed',
          work,
          error: String(error),
        });
      throw error;
    } finally {
      if (!wasRunning && !writesEnabled && (options.check || !succeeded)) {
        try {
          await requestHost(home, 'stop', { id });
        } catch (error) {
          throw new Error(
            (failure ? String(failure) + '；' : '') +
              '无法恢复网站原先的停止状态，请检查 host status：' +
              String(error),
          );
        }
      }
    }
  });
}
export async function recoverProtected(home: string, root: string, restoreData = false) {
  return withUpgradeLock(root, async () => {
    const file = join(root, '.weava-preparation.json'),
      prepared = json<any>(file),
      id = descriptor(root).id;
    const journalFile = join(root, '.weava-update.json'),
      journal = existsSync(journalFile) ? json<any>(journalFile) : null;
    if (journal?.writesEnabled && journal.status !== 'rolled-back' && !restoreData) {
      if (
        journal.status === 'complete' &&
        !['stopped', 'maintenance', 'activation-failed'].includes(prepared.status)
      )
        throw new Error('已完成升级；回退数据需要明确使用 --restore-data。');
      const operation = journal.online?.operation ?? prepared.operation;
      await requestHost(home, 'start', { id });
      await checkService(root, { agent: 'WeavaUpgradeCheck' });
      await requestHost(home, 'activate', { id });
      maintenance(home, id, false, operation);
      try {
        const origin = loadInstallation(home).sites[id]?.proxyOrigin,
          probe = journal.activationProbe;
        if (origin) {
          const response = await fetch(origin + '/', {
            headers: probe?.domain ? { Host: new URL(probe.domain).host } : undefined,
            signal: AbortSignal.timeout(15000),
          });
          await response.body?.cancel();
          if (response.status !== (probe?.status ?? 200))
            throw new Error('反向代理恢复访问后检查失败。');
        }
        atomic(journalFile, {
          ...journal,
          status: 'complete',
          recoveredAt: new Date().toISOString(),
        });
        atomic(file, { ...prepared, status: 'complete', recoveredAt: new Date().toISOString() });
        return { recovered: true, point: null, dataPreserved: true };
      } catch (error) {
        maintenance(home, id, true, operation);
        throw error;
      }
    }
    const pendingPreparation = ['maintenance', 'stopped', 'recovery-required'].includes(
      prepared.status,
    );
    const pendingJournal = journal && !['complete', 'rolled-back'].includes(journal.status);
    const restore =
      !!journal?.point &&
      !!journal.online?.operation &&
      journal.status !== 'rolled-back' &&
      (restoreData ||
        pendingJournal ||
        (pendingPreparation && journal.online.operation === prepared.operation));
    if (restoreData && !restore)
      throw new Error('没有可回退的数据恢复点；未修改网站数据或运行状态。');
    if (!restoreData && !pendingPreparation && !pendingJournal) {
      if (journal?.status === 'complete' || prepared.status === 'complete')
        throw new Error('已完成升级；回退数据需要明确使用 --restore-data。');
      return { recovered: false, point: null };
    }
    if (pendingJournal && !restore)
      throw new Error('升级恢复记录不完整，未修改网站；请检查 .weava-update.json。');
    const operation = restore ? journal.online.operation : prepared.operation;
    const marker = join(proxyDirectory(home, id), 'active.json');
    if (existsSync(marker) && ![operation, prepared.operation].includes(json(marker).operation))
      throw new Error('维护标记不属于待恢复的升级，未修改网站。');
    await requestHost(home, 'stop', { id });
    // The committed migration journal remains authoritative even for old sites
    // whose preparation record was overwritten by an earlier --check.
    if (restore) {
      const p = programFor(loadInstallation(home), journal.programId);
      await withLease(home, root, p, async () => {
        restoreCheckpoint(journal.point, root);
        atomic(journalFile, { ...journal, status: 'rolled-back' });
      });
    }
    await requestHost(home, 'start', { id });
    await checkService(root, { agent: 'WeavaUpgradeCheck' });
    if (existsSync(marker)) maintenance(home, id, false, json(marker).operation);
    atomic(file, {
      ...prepared,
      operation,
      status: 'rolled-back',
      recoveredAt: new Date().toISOString(),
    });
    return { recovered: true, point: restore ? journal.point : null };
  });
}
