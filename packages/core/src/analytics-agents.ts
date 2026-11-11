const crawlers = new Set([
  'googlebot', 'googleother', 'bingbot', 'applebot', 'duckduckbot', 'baiduspider', 'yandexbot',
  'oai-searchbot', 'gptbot', 'chatgpt-user', 'oai-adsbot',
  'claude-searchbot', 'claudebot', 'claude-user',
  'perplexitybot', 'perplexity-user', 'bytespider', 'amazonbot',
  'facebookexternalhit', 'facebot', 'linkedinbot', 'twitterbot', 'discordbot', 'slackbot', 'telegrambot',
]);

/** A declared product token identifies how to count a request, not who sent it. */
export function declaredCrawler(agent: string): string | undefined {
  for (const product of agent.toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? []) {
    if (crawlers.has(product)) return product;
    if (/^googlebot-(image|news|video)$/.test(product)) return 'googlebot';
    if (product === 'slackbot-linkexpanding') return 'slackbot';
  }
}

export function isAutomatedAgent(agent: string): boolean {
  return !!declaredCrawler(agent) ||
    /(?:^|[\s;(])(?:[\w-]*(?:bot|crawler|spider)|headlesschrome|headless|playwright|preview|slurp)(?=$|[\s/;)])/i.test(agent) ||
    /^\s*(?:curl|wget|python-requests|go-http-client)\//i.test(agent);
}
