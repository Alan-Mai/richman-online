// Reads the tables.json written by `pnpm -F extract cli tables`, picked by the player. The file is
// read in the browser and never uploaded; only the animation tables are used for now.
import {
  parseOriginalTables,
  type OriginalTables,
  type OriginalTablesError,
} from '@richman/shared';
import { t } from '../i18n';

export type ReadTablesResult =
  { ok: true; tables: OriginalTables } | { ok: false; problems: string[] };

function describeProblem(error: OriginalTablesError): string {
  switch (error.kind) {
    case 'unsupportedVersion':
      return t('setup.tables.error.version');
    case 'missing':
      return t('setup.tables.error.field', { path: error.path, problem: t('tables.missing') });
    case 'wrongType':
      return t('setup.tables.error.field', { path: error.path, problem: t('tables.wrongType') });
    case 'wrongLength':
      return t('setup.tables.error.field', {
        path: error.path,
        problem: t('tables.wrongLength', { expected: error.expected }),
      });
    case 'outOfRange':
      return t('setup.tables.error.field', { path: error.path, problem: t('tables.outOfRange') });
  }
}

export function readOriginalTables(text: string): ReadTablesResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: [t('setup.tables.error.json')] };
  }
  const parsed = parseOriginalTables(json);
  return parsed.ok
    ? { ok: true, tables: parsed.tables }
    : { ok: false, problems: parsed.errors.map(describeProblem) };
}
