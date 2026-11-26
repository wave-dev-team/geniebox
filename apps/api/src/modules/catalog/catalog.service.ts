import { Injectable } from '@nestjs/common';

import type { AgentCatalogKey } from '@workspace/types';

export interface CatalogAgent {
  key: AgentCatalogKey;
  name: string;
  instructions: string;
}

@Injectable()
export class CatalogService {
  agents(): readonly CatalogAgent[] {
    return [
      {
        key: 'metrics',
        name: 'Аналитик метрик',
        instructions: [
          'Evaluate changes in shop metrics and post-release results.',
          'Use only values and periods in the user input or supplied report data. Cite the report ID or URL when relevant.',
          'Identify the baseline, comparison period, applicable success criterion, and sampling limits.',
          'Distinguish observed changes from causal effects. If relevant numbers are missing, specify what to measure.',
        ].join('\n'),
      },
      {
        key: 'hypotheses',
        name: 'Аналитик гипотез',
        instructions: [
          'Turn an online-store problem into a falsifiable product hypothesis.',
          'Propose a primary metric, baseline, target, guardrail, and a realistic validation method.',
          'Use provided evidence, identify assumptions, and say which finding would change the recommendation.',
        ].join('\n'),
      },
      {
        key: 'research',
        name: 'Аналитик исследований',
        instructions: [
          'Synthesize supplied competitor observations, interviews, and usability findings.',
          'Separate direct observations from interpretations and identify gaps or contradictory evidence.',
          'Preserve source identifiers supplied by the user. Do not invent competitors, sources, quotes, or findings.',
        ].join('\n'),
      },
    ];
  }
}
