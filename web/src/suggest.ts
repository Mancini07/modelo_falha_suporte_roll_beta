import type { TreePosition } from './types';

/**
 * Pares de lado que aparecem nos nomes dos pontos. Comparar lado acionamento
 * contra lado oposto no mesmo ativo é justamente o caso de lubrificação.
 */
const SIDE_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bLOA\b/i, /\bLA\b/i],
  [/\bopposite\s+drive\s+side\b/i, /\bdrive\s+side\b/i],
  [/\bop\s+side\b/i, /\bdrive\s+side\b/i],
  [/\blado\s+oposto\b/i, /\blado\s+motriz\b/i],
  [/\btraseiro\b/i, /\bdianteiro\b/i],
];

export interface Suggestion {
  a: TreePosition;
  b: TreePosition;
  /** por que estes dois foram sugeridos */
  why: string;
}

/**
 * Sugere o par mais provável de um ativo. Pontos com o mesmo grupo de numeração
 * ("03.6" e "03.7") e lados opostos são o palpite mais forte; um ativo com
 * exatamente dois pontos é o segundo.
 */
export function suggestPair(positions: TreePosition[]): Suggestion | null {
  if (positions.length < 2) return null;

  for (const [oppositeRe, driveRe] of SIDE_PAIRS) {
    // "LOA" também casa com /\bLA\b/? Não — \b impede. Mas a ordem importa:
    // testa o lado oposto primeiro, que costuma ser o sufixo mais longo.
    const opposite = positions.filter((p) => oppositeRe.test(p.positionName));
    const drive = positions.filter(
      (p) => driveRe.test(p.positionName) && !oppositeRe.test(p.positionName),
    );
    if (opposite.length === 0 || drive.length === 0) continue;

    // Prefere os que compartilham o mesmo grupo de numeração.
    for (const d of drive) {
      const g = group(d.positionName);
      const match = opposite.find((o) => g != null && group(o.positionName) === g);
      if (match) {
        return { a: d, b: match, why: 'opposite sides of the same set' };
      }
    }
    return { a: drive[0], b: opposite[0], why: 'drive side and opposite side' };
  }

  if (positions.length === 2) {
    return { a: positions[0], b: positions[1], why: 'the only two points on the asset' };
  }
  return null;
}

/** "03.6 - Mancal LA" -> "03" */
function group(name: string): string | null {
  const m = name.match(/^\s*(\d+)\./);
  return m ? m[1] : null;
}
