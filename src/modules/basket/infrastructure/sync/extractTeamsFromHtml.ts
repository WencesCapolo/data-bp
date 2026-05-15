import { readFileSync } from 'node:fs';
import type { TeamProps } from '@basket/core/entities/Team';

interface RawTeam {
  team_name: string;
  league: string;
  country: string;
  tier: number;
  type: string;
}

const KEY = '"team_league_assignment":';

function findBalancedObjectEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('Unbalanced braces parsing team_league_assignment');
}

export function extractTeamsFromHtml(htmlPath: string): TeamProps[] {
  const html = readFileSync(htmlPath, 'utf-8');
  const keyIdx = html.indexOf(KEY);
  if (keyIdx === -1) throw new Error('team_league_assignment key not found');
  const jsonStart = keyIdx + KEY.length;
  const jsonEnd = findBalancedObjectEnd(html, jsonStart);
  const raw = JSON.parse(html.slice(jsonStart, jsonEnd)) as Record<string, RawTeam>;
  return Object.entries(raw).map(([id, t]) => ({
    id: Number(id),
    teamName: t.team_name,
    league: t.league,
    country: t.country,
    tier: t.tier,
    type: t.type,
  }));
}
