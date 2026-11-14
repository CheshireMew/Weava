import { resolve } from 'node:path';
import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  defaultSettings,
  type Entry,
  type Release,
  type Block,
  type FieldWidget,
  type BlockDefinition,
} from '@weava/contracts';
import {Storage} from './storage.ts';
import { OwnerAuth } from './owner-auth.ts';
import { JobStore } from './job-store.ts';
import { SiteSettings } from './site-settings.ts';
import { SiteContent } from './site-content.ts';
import { SiteReleases } from './site-releases.ts';
import { EntryRepository } from './entry-repository.ts';
import { MediaRepository } from './media-repository.ts';
import { SiteBlocks } from './site-blocks.ts';
/** Composes site services and preserves the public entry points used by extensions and CLI. */
export class Site {
  store: Storage;
  blockRenderers: Record<string, (block: Block, release: Release, entry?: Entry) => string> = {};
  extensionBlockDefinitions: Record<string, BlockDefinition> = {};
  extensionThemes: string[] = [];
  fieldWidgets: Record<string, FieldWidget> = {};
  extensionCleanup?: () => void;
  publicationValidators: ((release: Release) => void)[] = [];
  readonly auth: OwnerAuth;
  readonly jobStore: JobStore;
  readonly configuration: SiteSettings;
  readonly content: SiteContent;
  readonly publication: SiteReleases;
  readonly entryStore: EntryRepository;
  readonly media: MediaRepository;
  readonly blocks: SiteBlocks;
  constructor(public root: string, options: { mode?: 'open' | 'migrate' } = {}) {
    this.root = resolve(root);
    const initialize = !existsSync(join(this.root,'weava.sqlite')) || (options.mode??process.env.WEAVA_DATABASE_MODE)==='migrate';
    this.store = new Storage(root, true, options.mode);
    this.auth = new OwnerAuth(this.store, this.root);
    this.jobStore = new JobStore(this.store);
    this.media = new MediaRepository(this.store);
    this.entryStore = new EntryRepository(this.store);
    this.configuration = new SiteSettings(this);
    this.content = new SiteContent(this);
    this.publication = new SiteReleases(this);
    this.blocks = new SiteBlocks(this);
    try {
      if(!initialize&&(!this.store.get('settings','site')||!existsSync(join(root,'cli-token'))||!this.store.state('engagement-secret')))
        throw new Error('站点初始化不完整，请执行 site update 或 site adopt；普通打开不会补写资料。');
      if (!this.store.get('settings', 'site'))
        this.store.put('settings', 'site', defaultSettings, null, '初始化');
      if (!existsSync(join(root, 'cli-token')))
        writeFileSync(join(root, 'cli-token'), randomBytes(32).toString('hex'), {flag:'wx',mode:0o600});
      // Preserve reader identities when an administrator revokes a CLI credential.
      // Existing sites keep their original signing value; new rotations never replace it.
      if (!this.store.state('engagement-secret'))
        this.store.setState('engagement-secret',readFileSync(join(root,'cli-token'),'utf8'));
    } catch (error) {
      this.store.close();
      throw error;
    }
  }
  close() {
    this.extensionCleanup?.();
    this.store.close();
  }
  setOwner = (...args: Parameters<OwnerAuth['setOwner']>) => this.auth.setOwner(...args);
  ownerExists = (...args: Parameters<OwnerAuth['ownerExists']>) => this.auth.ownerExists(...args);
  login = (...args: Parameters<OwnerAuth['login']>) => this.auth.login(...args);
  authenticate = (...args: Parameters<OwnerAuth['authenticate']>) =>
    this.auth.authenticate(...args);
  logout = (...args: Parameters<OwnerAuth['logout']>) => this.auth.logout(...args);
  cliToken = (...args: Parameters<OwnerAuth['cliToken']>) => this.auth.cliToken(...args);
  engagementSecret = () => this.store.state('engagement-secret')!;
  job = (...args: Parameters<JobStore['job']>) => this.jobStore.job(...args);
  jobs = (...args: Parameters<JobStore['jobs']>) => this.jobStore.jobs(...args);
  createJob = (...args: Parameters<JobStore['createJob']>) => this.jobStore.createJob(...args);
  updateJob = (...args: Parameters<JobStore['updateJob']>) => this.jobStore.updateJob(...args);
  recoverJobs = (...args: Parameters<JobStore['recoverJobs']>) =>
    this.jobStore.recoverJobs(...args);
  activeJobs = (...args: Parameters<JobStore['activeJobs']>) => this.jobStore.activeJobs(...args);
  settings = (...args: Parameters<SiteSettings['settings']>) =>
    this.configuration.settings(...args);
  saveSettings = (...args: Parameters<SiteSettings['saveSettings']>) =>
    this.configuration.saveSettings(...args);
  terms = (...args: Parameters<SiteSettings['terms']>) => this.configuration.terms(...args);
  saveTerm = (...args: Parameters<SiteSettings['saveTerm']>) =>
    this.configuration.saveTerm(...args);
  saveType = (...args: Parameters<SiteContent['saveType']>) => this.content.saveType(...args);
  entries = (...args: Parameters<SiteContent['entries']>) => this.content.entries(...args);
  saveEntry = (...args: Parameters<SiteContent['saveEntry']>) => this.content.saveEntry(...args);
  history = (...args: Parameters<SiteContent['history']>) => this.content.history(...args);
  restore = (...args: Parameters<SiteContent['restore']>) => this.content.restore(...args);
  release = (...args: Parameters<SiteReleases['release']>) => this.publication.release(...args);
  releases = (...args: Parameters<SiteReleases['releases']>) => this.publication.releases(...args);
  visibleRelease = (...args: Parameters<SiteReleases['visibleRelease']>) =>
    this.publication.visibleRelease(...args);
  isPrivateMedia = (...args: Parameters<SiteReleases['isPrivateMedia']>) =>
    this.publication.isPrivateMedia(...args);
  redirect = (...args: Parameters<SiteReleases['redirect']>) => this.publication.redirect(...args);
  previewPublication = (...args: Parameters<SiteReleases['previewPublication']>) =>
    this.publication.previewPublication(...args);
  publish = (...args: Parameters<SiteReleases['publish']>) => this.publication.publish(...args);
  withdrawalOptions = (...args: Parameters<SiteReleases['withdrawalOptions']>) =>
    this.publication.withdrawalOptions(...args);
  withdraw = (...args: Parameters<SiteReleases['withdraw']>) => this.publication.withdraw(...args);
  rollback = (...args: Parameters<SiteReleases['rollback']>) => this.publication.rollback(...args);
  previewRollback = (...args: Parameters<SiteReleases['previewRollback']>) => this.publication.previewRollback(...args);
  validateReleaseExtensions = (...args: Parameters<SiteReleases['validateReleaseExtensions']>) =>
    this.publication.validateReleaseExtensions(...args);
  search = (...args: Parameters<SiteReleases['search']>) => this.publication.search(...args);
  validateBlocks = (...args: Parameters<SiteBlocks['validateBlocks']>) =>
    this.blocks.validateBlocks(...args);
}
export { normalizePath } from './paths.ts';
