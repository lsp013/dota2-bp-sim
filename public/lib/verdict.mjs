/* AUTO-GENERATED from src/ by scripts/sync-lib.mjs — do not edit here. */
/**
 * Human-readable verdict for a matchup win rate.
 *
 * The detail sheet used to show a CONFIDENCE tag here (可靠 / 参考 / 样本少),
 * which answered "can I trust this number?" — a question the 场次 column already
 * answers. What a player actually wants next to "对阵敌方已选" is "does this
 * hero beat them?", so the tag now says that.
 *
 * Thresholds:
 *   > 52%          非常克制   (the user's cutoff — "过52即非常克制")
 *   50% – 52%      克制
 *   < 50%          不克制
 *
 * Sample size is deliberately NOT duplicated into this verdict: a 40-game 65%
 * and a 5000-game 65% are both "非常克制" here, and the 场次 column (plus a
 * low-sample marker under 30 games) is where that distinction belongs. Mixing
 * the two into one label is what made the old tag useless.
 */

/** Above this, the matchup is a strong counter. */
export const STRONG_AT = 0.52;
/** At or above this, the matchup is mildly favourable. */
export const MILD_AT = 0.5;

export const VERDICTS = {
  strong: { key: 'strong', label: '非常克制', cls: 't-strong' },
  mild: { key: 'mild', label: '克制', cls: 't-mild' },
  weak: { key: 'weak', label: '不克制', cls: 't-weak' },
  unknown: { key: 'unknown', label: '—', cls: 't-unknown' },
};

/**
 * @param {number|null|undefined} p win rate of the hero being described
 * @returns {{key:string, label:string, cls:string}}
 */
export function counterVerdict(p) {
  if (!Number.isFinite(p)) return VERDICTS.unknown;
  // "过 52" is strictly greater, so exactly 52.0% lands in 克制.
  if (p > STRONG_AT) return VERDICTS.strong;
  if (p >= MILD_AT) return VERDICTS.mild;
  return VERDICTS.weak;
}
