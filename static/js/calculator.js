/**
 * Doomsday Hedging Calculator
 *
 * Polymarket shares are binary options priced 0–1.
 * A YES share pays $1 if the event resolves YES, $0 otherwise.
 * A NO share pays $1 if the event resolves NO,  $0 otherwise.
 *
 * Perfect hedge condition:
 *   For equal P&L in both outcomes you need equal share counts on each side.
 *
 *   Proof:
 *     P&L(YES wins) = n_long*(1 - p_long) - n_short*p_short
 *     P&L(NO  wins) = n_short*(1 - p_short) - n_long*p_long
 *     Set equal → n_long = n_short
 *
 *   Locked-in P&L per outcome after hedge = N*(1 - p_long - p_short)
 *     where N = number of matched pairs
 *
 *   If p_long + p_short < 1 → guaranteed profit   (arbitrage / inefficiency)
 *   If p_long + p_short = 1 → break even
 *   If p_long + p_short > 1 → guaranteed loss      (over-paying the spread)
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(decimals);
}

function fmtShares(n) {
  if (!isFinite(n)) return '—';
  return Number(n.toFixed(4)).toLocaleString();
}

function fmtPct(n) {
  if (!isFinite(n)) return '—';
  return (n * 100).toFixed(2) + '%';
}

function colorClass(n) {
  if (n > 0.0001) return 'positive';
  if (n < -0.0001) return 'negative';
  return 'zero';
}

function val(id) {
  const v = parseFloat(document.getElementById(id).value);
  return isNaN(v) ? null : v;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeDte(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
  return diff > 0 ? diff : null;
}

// ─── Core calculation ─────────────────────────────────────────────────────────

function calculate() {
  const capital       = val('capital')       ?? 0;
  const longPrice     = val('longPrice');
  const longShares    = val('longShares')    ?? 0;
  const thetaDrop     = val('longThetaDrop') ?? 10;   // % decay
  const thetaDays     = val('longThetaDays') ?? 180;
  // Multiplicative decay: yesPrice × (1 - thetaDrop/100)^(dte/thetaDays)
  // longTheta = per-day decay factor
  const longTheta     = thetaDays > 0 ? Math.pow(1 - thetaDrop / 100, 1 / thetaDays) : 1;
  const longExpDate   = document.getElementById('longExpDate').value;
  const shortPrice    = val('shortPrice');
  const shortShares   = val('shortShares')   ?? 0;
  const shortExpDate  = document.getElementById('shortExpDate').value;

  const longDte  = computeDte(longExpDate);
  const shortDte = computeDte(shortExpDate);

  // Update theta hint: show daily factor and what e.g. 0.90 YES becomes after thetaDays
  const thetaHint = document.getElementById('longThetaHint');
  if (thetaHint) thetaHint.textContent = thetaDays > 0
    ? `${thetaDrop}% of YES price over ${thetaDays}d — e.g. 0.90 → ${(0.9 * Math.pow(1 - thetaDrop/100, 1)).toFixed(3)}, 0.10 → ${(0.1 * Math.pow(1 - thetaDrop/100, 1)).toFixed(3)}`
    : 'Daily factor: —';

  // Update DTE hints
  const longHint  = document.getElementById('longDteHint');
  const shortHint = document.getElementById('shortDteHint');
  if (longHint)  longHint.textContent  = longDte  ? `${longDte} days to expiry`  : (longExpDate  ? 'Date in the past' : '—');
  if (shortHint) shortHint.textContent = shortDte ? `${shortDte} days to expiry` : (shortExpDate ? 'Date in the past' : '—');

  // Update derived position costs immediately
  updatePositionCost('longCost',  longPrice,  longShares);
  updatePositionCost('shortCost', shortPrice, shortShares);

  // Need at least both prices to show results
  if (longPrice === null || shortPrice === null) {
    showPlaceholder();
    return;
  }

  if (longPrice <= 0 || longPrice >= 1 || shortPrice <= 0 || shortPrice >= 1) {
    showPlaceholder('Prices must be between 0 and 1 (exclusive).');
    return;
  }

  // Time-value discount on YES payout: when doomsday happens before expiry,
  // YES shares trade at ~1 − 4%APR×DTE/365 rather than $1.00 immediately.
  const DOOMSDAY_RATE = 0.04;
  const effectiveYesValue = longDte && longDte > 0
    ? 1 - DOOMSDAY_RATE * longDte / 365
    : 1.0;

  showResults({ capital, longPrice, longShares, longTheta, longDte, effectiveYesValue, shortPrice, shortShares, shortDte });
}

function updatePositionCost(id, price, shares) {
  const el = document.getElementById(id).querySelector('.derived-value');
  if (price === null || shares === 0) {
    el.textContent = '—';
    el.className = 'derived-value';
    return;
  }
  const cost = price * shares;
  el.textContent = fmt(cost);
  el.className = 'derived-value';
}

// ─── Render results ───────────────────────────────────────────────────────────

function showPlaceholder(msg) {
  const ph = document.getElementById('resultsPlaceholder');
  ph.querySelector('span').textContent = msg || 'Enter prices and share counts above to see your hedge analysis.';
  ph.classList.remove('hidden');
  document.getElementById('resultsContent').classList.add('hidden');
}

function showResults({ capital, longPrice, longShares, longTheta, longDte, effectiveYesValue, shortPrice, shortShares, shortDte }) {
  document.getElementById('resultsPlaceholder').classList.add('hidden');
  document.getElementById('resultsContent').classList.remove('hidden');

  // ── Current P&L ───────────────────────────────────────────────────────────
  // Path 1 (YES/Doomsday): YES → effectiveYesValue (discounted $1), NO → $0
  const pnlYes = longShares * (effectiveYesValue - longPrice) - shortShares * shortPrice;

  // Path 2 (NO): NO → $1, YES decays multiplicatively by (longTheta^shortDte)
  // longTheta is the per-day factor, e.g. 0.9994 for 10%/180d
  const decayMultiplier  = longTheta < 1 && shortDte ? Math.pow(longTheta, shortDte) : 1;
  const yesPriceAtNoRes  = longPrice * decayMultiplier;
  const thetaDecay       = longPrice - yesPriceAtNoRes; // dollar decay for display
  const pnlNo = shortShares * (1 - shortPrice) + longShares * (yesPriceAtNoRes - longPrice);

  // Update Path 2 tooltip dynamically
  const pnlNoTooltip = document.getElementById('pnlNoTooltip');
  if (pnlNoTooltip) {
    pnlNoTooltip.dataset.tooltip = thetaDecay > 0.0001
      ? `NO shares pay out $1 each. YES price decays multiplicatively by ×${decayMultiplier.toFixed(4)} total over ${shortDte} days, from $${longPrice.toFixed(4)} to $${yesPriceAtNoRes.toFixed(4)} per share.`
      : `Time passes and the doomsday event doesn't happen. NO shares pay out $1 each. YES shares hold their current market price — no gain or loss on that leg.`;
  }

  renderPnlCard('pnlYes', 'Path 1 — YES wins (Doomsday)', pnlYes);
  const path2Label = thetaDecay > 0.0001
    ? `Path 2 — NO wins (YES ×${decayMultiplier.toFixed(4)} → ${fmt(yesPriceAtNoRes, 4)}/share)`
    : 'Path 2 — NO wins (YES holds flat)';
  renderPnlCard('pnlNo', path2Label, pnlNo);

  // ── Hedge recommendation (Path 1 based) ──────────────────────────────────
  //
  // Path 1 P&L = n_long × (1−p_long) − n_short × p_short
  // Net positive when: n_short < n_long × (1−p_long) / p_short
  //
  // noBreakeven  = total NO shares where Path 1 hits exactly $0
  // noHeadroom   = additional NO you can still buy before Path 1 goes negative
  // yesNeeded    = YES shares needed to make Path 1 > $0 (when Path 1 is currently ≤ 0)

  const recBody = document.getElementById('recBody');

  // Projected state used for the "After Hedging" metrics below
  let postLong  = longShares;
  let postShort = shortShares;

  if (longShares === 0 && shortShares === 0) {
    // ── No position yet ───────────────────────────────────────────────────
    recBody.innerHTML = `
      <span class="rec-action balanced">No position entered yet.</span>
      <span class="rec-detail">Enter your YES and/or NO share counts to get a Path 1 hedge recommendation.</span>
    `;
  } else {
    // NO shares floored — can't buy fractional shares
    const noBreakeven = Math.floor(longShares * (effectiveYesValue - longPrice) / shortPrice);
    const noHeadroom  = noBreakeven - shortShares;

    if (pnlYes > 0.0001) {
      // ── Path 1 is currently positive — show headroom ──────────────────
      const addlFromCapital = capital > 0 ? Math.floor(capital / shortPrice) : 0;
      const cost = noHeadroom * shortPrice;
      const capitalNote = capital > 0 && cost > capital
        ? `<div class="capital-warning">⚠ Full headroom cost (${fmt(cost)}) exceeds available capital (${fmt(capital)}). With your capital you can buy ${addlFromCapital} NO shares — Path 1 would then be ${fmt(longShares * (effectiveYesValue - longPrice) - (shortShares + addlFromCapital) * shortPrice)}.</div>`
        : '';

      recBody.innerHTML = `
        <span class="rec-action buy-short">Buy up to <strong>${noBreakeven - Math.ceil(shortShares)}</strong> more NO shares</span>
        <span class="rec-detail">
          Path 1 is currently <strong class="positive">${fmt(pnlYes)}</strong> positive.
          You can add up to <strong>${noBreakeven - Math.ceil(shortShares)}</strong> NO shares @ ${fmt(shortPrice, 4)}/share
          (cost: ${fmt(noHeadroom * shortPrice)}) and doomsday still leaves you net positive.
          At ${noBreakeven} total NO shares, Path 1 breaks even at $0.
        </span>
        ${capitalNote}
      `;
      postShort = noBreakeven;

    } else if (pnlYes < -0.0001) {
      // ── Path 1 is currently negative — need more YES ──────────────────
      const yesNeeded    = shortShares * shortPrice / (effectiveYesValue - longPrice);
      const yesAdditional = yesNeeded - longShares;
      const cost = yesAdditional * longPrice;
      const capitalNote = capital > 0 && cost > capital
        ? `<div class="capital-warning">⚠ Cost to reach Path 1 breakeven (${fmt(cost)}) exceeds available capital (${fmt(capital)}). With your capital you can buy ${fmtShares(capital / longPrice)} more YES — Path 1 would then be ${fmt((longShares + capital / longPrice) * (effectiveYesValue - longPrice) - shortShares * shortPrice)}.</div>`
        : '';

      recBody.innerHTML = `
        <span class="rec-action buy-long">Buy <strong>${fmtShares(yesAdditional)}</strong> more YES shares to reach Path 1 breakeven</span>
        <span class="rec-detail">
          Path 1 is currently <strong class="negative">${fmt(pnlYes)}</strong>.
          You need <strong>${fmtShares(yesNeeded)}</strong> total YES shares to cover your
          <strong>${fmtShares(shortShares)}</strong> NO shares in the doomsday scenario.
          Buy <strong>${fmtShares(yesAdditional)}</strong> more YES @ ${fmt(longPrice, 4)}/share (cost: ${fmt(cost)}).
        </span>
        ${capitalNote}
      `;
      postLong = yesNeeded;

    } else {
      // ── Path 1 is already at exactly $0 ──────────────────────────────
      recBody.innerHTML = `
        <span class="rec-action balanced">Path 1 is at breakeven ($0.00).</span>
        <span class="rec-detail">Sell any NO shares to move Path 1 positive, or buy more YES shares to create upside if doomsday happens.</span>
      `;
    }
  }

  // ── Post-hedge metrics ────────────────────────────────────────────────────
  const totalInvested = postLong * longPrice + postShort * shortPrice;

  // Path 1 (YES/Doomsday): YES → effectiveYesValue, NO → $0
  const path1Pnl = postLong * (effectiveYesValue - longPrice) - postShort * shortPrice;
  const path1Roi = totalInvested > 0 ? path1Pnl / totalInvested : 0;

  // Path 2 (NO): NO → $1, YES decays by theta × shortDte (default 0 → flat)
  const path2Pnl = postShort * (1 - shortPrice) + postLong * (yesPriceAtNoRes - longPrice);
  const path2Roi = totalInvested > 0 ? path2Pnl / totalInvested : 0;

  const postHedgeGrid = document.getElementById('postHedgeGrid');
  postHedgeGrid.innerHTML = `
    <div class="post-hedge-item">
      <span class="post-hedge-label">YES Shares</span>
      <span class="post-hedge-value">${fmtShares(postLong)}</span>
    </div>
    <div class="post-hedge-item">
      <span class="post-hedge-label">NO Shares</span>
      <span class="post-hedge-value">${fmtShares(postShort)}</span>
    </div>
    <div class="post-hedge-item">
      <span class="post-hedge-label">Total Invested</span>
      <span class="post-hedge-value">${fmt(totalInvested)}</span>
    </div>
    <div class="post-hedge-item path1">
      <span class="post-hedge-label">Path 1 P&L — YES wins</span>
      <span class="post-hedge-value ${colorClass(path1Pnl)}">${fmt(path1Pnl)}</span>
    </div>
    <div class="post-hedge-item path1">
      <span class="post-hedge-label">Path 1 ROI — YES wins</span>
      <span class="post-hedge-value ${colorClass(path1Roi)}">${fmtPct(path1Roi)}</span>
    </div>
    <div class="post-hedge-item path2">
      <span class="post-hedge-label">Path 2 P&L — NO wins</span>
      <span class="post-hedge-value ${colorClass(path2Pnl)}">${fmt(path2Pnl)}</span>
    </div>
    <div class="post-hedge-item path2">
      <span class="post-hedge-label">Path 2 ROI — NO wins</span>
      <span class="post-hedge-value ${colorClass(path2Roi)}">${fmtPct(path2Roi)}</span>
    </div>
  `;

  // ── Sentiment change breakeven ────────────────────────────────────────────
  renderSentimentSection({ longShares, shortShares, longPrice, shortPrice });

  // ── Math breakdown ────────────────────────────────────────────────────────
  renderMath({
    longPrice, longShares, longTheta, longDte, thetaDecay, yesPriceAtNoRes,
    effectiveYesValue,
    shortPrice, shortShares, shortDte,
    postLong, postShort,
    pnlYes, pnlNo,
    totalInvested, path1Pnl, path1Roi, path2Pnl, path2Roi,
  });
}

function renderPnlCard(id, label, amount) {
  const card = document.getElementById(id);
  card.innerHTML = `
    <div class="pnl-scenario">${label} (current position)</div>
    <div class="pnl-amount ${colorClass(amount)}">${fmt(amount)}</div>
  `;
}

function renderSentimentSection({ longShares, shortShares, longPrice, shortPrice }) {
  const section = document.getElementById('sentimentSection');
  const body    = document.getElementById('sentimentBody');
  if (!section || !body) return;

  if (longShares <= 0 || shortShares <= 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  // Max profit from NO side assuming NO fully pays out ($1 per share):
  //   max_no_profit    = n_no × (1 − p_no)
  //   breakeven_drop   = max_no_profit ÷ n_yes
  // This is the largest YES price drop your NO gains can absorb before you start losing money.
  const maxNoProfit   = shortShares * (1 - shortPrice);
  const breakevenDrop = maxNoProfit / longShares;

  body.innerHTML = `
    <div class="p1hedge-rows">
      <div class="p1hedge-row info">
        <span class="p1hedge-row-label">
          Max NO-side profit (NO fully pays $1)<br>
          <small>${fmtShares(shortShares)} NO shares × (1 − ${fmt(shortPrice, 4)} NO price)</small>
        </span>
        <span class="p1hedge-row-value positive">${fmt(maxNoProfit)}</span>
      </div>
      <div class="p1hedge-row ${breakevenDrop > 0 ? 'buy-no' : 'warn'}">
        <span class="p1hedge-row-label">
          Breakeven YES price drop<br>
          <small>YES can drop at most this much before NO gains no longer cover your YES losses</small>
        </span>
        <span class="p1hedge-row-value ${colorClass(breakevenDrop)}">${fmt(breakevenDrop, 4)}</span>
      </div>
      <div class="p1hedge-row info">
        <span class="p1hedge-row-label">
          YES breakeven price after drop<br>
          <small>Current ${fmt(longPrice, 4)} − drop ${fmt(breakevenDrop, 4)}</small>
        </span>
        <span class="p1hedge-row-value">${fmt(Math.max(0, longPrice - breakevenDrop), 4)}</span>
      </div>
    </div>
    <div class="p1hedge-formula">
      <span class="hl">Breakeven drop</span> = (n_no × (1 − p_no)) ÷ n_yes<br>
      = (<span class="hlr">${fmtShares(shortShares)}</span> × ${(1 - shortPrice).toFixed(4)}) ÷ <span class="hlg">${fmtShares(longShares)}</span><br>
      = ${fmt(maxNoProfit)} ÷ ${fmtShares(longShares)} = <span class="hl">${fmt(breakevenDrop, 4)}</span>
    </div>
  `;
}

function renderMath({
  longPrice, longShares, longTheta, longDte, thetaDecay, yesPriceAtNoRes,
  effectiveYesValue,
  shortPrice, shortShares, shortDte,
  postLong, postShort,
  pnlYes, pnlNo,
  totalInvested, path1Pnl, path1Roi, path2Pnl, path2Roi,
}) {
  const spread = longPrice + shortPrice;
  const yesPayoutLabel = effectiveYesValue < 1.0
    ? `$${effectiveYesValue.toFixed(4)} (=$1 discounted 4%APR × ${longDte}d)`
    : '$1.00';
  const mathBody = document.getElementById('mathBody');
  mathBody.innerHTML = `

    <div class="math-block">
      <div class="math-block-title">Current Position — Path 1: YES wins (Doomsday) · YES → ${yesPayoutLabel}, NO → $0</div>
      <div class="math-lines">
        <div class="math-line">
          <span>YES payout: ${fmtShares(longShares)} shares × (${yesPayoutLabel} − $${longPrice.toFixed(4)} entry)</span>
          <span class="expr">= ${fmtShares(longShares)} × ${(effectiveYesValue - longPrice).toFixed(4)}</span>
          <span class="result">${fmt(longShares * (effectiveYesValue - longPrice))}</span>
        </div>
        <div class="math-line">
          <span>NO loss: ${fmtShares(shortShares)} shares × $${shortPrice.toFixed(4)} paid, pays $0</span>
          <span class="expr">= −${fmt(shortShares * shortPrice)}</span>
          <span class="result negative">${fmt(-shortShares * shortPrice)}</span>
        </div>
        <div class="math-line total">
          <span>Net P&L — Path 1 (current position)</span>
          <span></span>
          <span class="result ${colorClass(pnlYes)}">${fmt(pnlYes)}</span>
        </div>
      </div>
    </div>

    <div class="math-block">
      <div class="math-block-title">Current Position — Path 2: NO wins · NO → $1, YES ${thetaDecay > 0.0001 ? `×${decayMultiplier.toFixed(4)} → $${yesPriceAtNoRes.toFixed(4)}` : 'stays flat'}</div>
      <div class="math-lines">
        <div class="math-line">
          <span>NO payout: ${fmtShares(shortShares)} shares × ($1.00 − $${shortPrice.toFixed(4)} entry)</span>
          <span class="expr">= ${fmtShares(shortShares)} × ${(1 - shortPrice).toFixed(4)}</span>
          <span class="result">${fmt(shortShares * (1 - shortPrice))}</span>
        </div>
        ${thetaDecay > 0.0001 ? `
        <div class="math-line">
          <span>YES decay: ×${decayMultiplier.toFixed(6)} over ${shortDte}d · ${fmtShares(longShares)} shares × ($${yesPriceAtNoRes.toFixed(4)} − $${longPrice.toFixed(4)})</span>
          <span class="expr">= ${fmt(longShares * (yesPriceAtNoRes - longPrice))}</span>
          <span class="result negative">${fmt(longShares * (yesPriceAtNoRes - longPrice))}</span>
        </div>` : `
        <div class="math-line">
          <span>YES position: price unchanged, entry = exit → $0 P&L</span>
          <span class="expr">= $0.00</span>
          <span class="result">$0.00</span>
        </div>`}
        <div class="math-line total">
          <span>Net P&L — Path 2 (current position)</span>
          <span></span>
          <span class="result ${colorClass(pnlNo)}">${fmt(pnlNo)}</span>
        </div>
      </div>
    </div>

    <div class="math-block">
      <div class="math-block-title">After Hedge — Path 1: YES wins (Doomsday) · YES → ${yesPayoutLabel}</div>
      <div class="math-lines">
        <div class="math-line">
          <span>YES payout: ${fmtShares(postLong)} shares × (${yesPayoutLabel} − $${longPrice.toFixed(4)})</span>
          <span class="expr">= ${fmtShares(postLong)} × ${(effectiveYesValue - longPrice).toFixed(4)}</span>
          <span class="result">${fmt(postLong * (effectiveYesValue - longPrice))}</span>
        </div>
        <div class="math-line">
          <span>NO loss: ${fmtShares(postShort)} shares × $${shortPrice.toFixed(4)} paid, pays $0</span>
          <span class="expr">= −${fmt(postShort * shortPrice)}</span>
          <span class="result negative">${fmt(-postShort * shortPrice)}</span>
        </div>
        <div class="math-line total">
          <span>Path 1 P&L</span>
          <span></span>
          <span class="result ${colorClass(path1Pnl)}">${fmt(path1Pnl)}</span>
        </div>
        <div class="math-line total">
          <span>Path 1 ROI = ${fmt(path1Pnl)} ÷ ${fmt(totalInvested)}</span>
          <span></span>
          <span class="result ${colorClass(path1Roi)}">${fmtPct(path1Roi)}</span>
        </div>
      </div>
    </div>

    <div class="math-block">
      <div class="math-block-title">After Hedge — Path 2: NO wins (YES ${thetaDecay > 0.0001 ? `×${decayMultiplier.toFixed(4)} → $${yesPriceAtNoRes.toFixed(4)}` : 'holds flat'})</div>
      <div class="math-lines">
        <div class="math-line">
          <span>NO payout: ${fmtShares(postShort)} shares × ($1.00 − $${shortPrice.toFixed(4)})</span>
          <span class="expr">= ${fmtShares(postShort)} × ${(1 - shortPrice).toFixed(4)}</span>
          <span class="result">${fmt(postShort * (1 - shortPrice))}</span>
        </div>
        ${thetaDecay > 0.0001 ? `
        <div class="math-line">
          <span>YES decay: ${fmtShares(postLong)} shares × ($${yesPriceAtNoRes.toFixed(4)} − $${longPrice.toFixed(4)})</span>
          <span class="expr">= ${fmt(postLong * (yesPriceAtNoRes - longPrice))}</span>
          <span class="result negative">${fmt(postLong * (yesPriceAtNoRes - longPrice))}</span>
        </div>` : `
        <div class="math-line">
          <span>YES position: price unchanged → $0 P&L</span>
          <span class="expr">= $0.00</span>
          <span class="result">$0.00</span>
        </div>`}
        <div class="math-line total">
          <span>Path 2 P&L</span>
          <span></span>
          <span class="result ${colorClass(path2Pnl)}">${fmt(path2Pnl)}</span>
        </div>
        <div class="math-line total">
          <span>Path 2 ROI = ${fmt(path2Pnl)} ÷ ${fmt(totalInvested)}</span>
          <span></span>
          <span class="result ${colorClass(path2Roi)}">${fmtPct(path2Roi)}</span>
        </div>
      </div>
    </div>

  `;
}

// ─── Path 1 Breakeven Hedge ───────────────────────────────────────────────────
//
// Goal: find share counts such that Path 1 P&L = 0
//   n_long × (1 − p_long) − n_short × p_short = 0
//   ⟹ n_long × (1 − p_long) = n_short × p_short
//
// Case A — capital given (solve 2-equation system for additional buys):
//   Let x = additional YES, y = additional NO
//   Budget:    x·p_long + y·p_short = capital
//   Breakeven: (longShares + x)·(1−p_long) = (shortShares + y)·p_short
//   Solving:   x = capital − longShares·(1−p_long) + shortShares·p_short
//              y = (capital − x·p_long) / p_short
//
// Case B — no capital, longShares known → solve for NO needed:
//   n_short_needed = longShares·(1−p_long) / p_short
//   additional NO  = n_short_needed − shortShares
//
// Case C — no capital, shortShares known → solve for YES needed:
//   n_long_needed  = shortShares·p_short / (1−p_long)
//   additional YES = n_long_needed − longShares

let p1hedgeVisible = false;

function toggleP1Hedge() {
  p1hedgeVisible = !p1hedgeVisible;
  const body = document.getElementById('p1hedgeBody');
  const btn  = document.getElementById('btnP1Hedge');
  if (p1hedgeVisible) {
    body.classList.remove('hidden');
    btn.textContent = 'Hide';
    btn.classList.add('active');
    renderP1Hedge();
  } else {
    body.classList.add('hidden');
    btn.textContent = 'Show';
    btn.classList.remove('active');
  }
}

function renderP1Hedge() {
  if (!p1hedgeVisible) return;

  const capital    = val('capital')    ?? 0;
  const longPrice  = val('longPrice');
  const longShares = val('longShares') ?? 0;
  const shortPrice = val('shortPrice');
  const shortShares= val('shortShares') ?? 0;
  const out        = document.getElementById('p1hedgeResult');

  if (longPrice === null || shortPrice === null) {
    out.innerHTML = `<div class="p1hedge-rows"><div class="p1hedge-row info">
      <span class="p1hedge-row-label">Enter both share prices to calculate a Path 1 breakeven hedge.</span>
    </div></div>`;
    return;
  }

  const pLong  = longPrice;
  const pShort = shortPrice;

  const longExpDate = document.getElementById('longExpDate').value;
  const longDte     = computeDte(longExpDate);
  const effectiveYesValue = longDte && longDte > 0 ? 1 - 0.04 * longDte / 365 : 1.0;
  const payoff = effectiveYesValue - pLong; // YES net payout per share (discounted)

  // ── Case A: capital is given ───────────────────────────────────────────────
  if (capital > 0) {
    // Solve: (longShares+x)·payoff = (shortShares+y)·pShort  AND  x·pLong + y·pShort = capital
    // → x = (capital − longShares·payoff + shortShares·pShort) / effectiveYesValue
    const x = (capital - longShares * payoff + shortShares * pShort) / effectiveYesValue;
    const y = Math.floor((capital - x * pLong) / pShort);

    const totalLong  = longShares + x;
    const totalShort = shortShares + y;
    const checkPnl   = totalLong * payoff - totalShort * pShort; // should ≈ 0

    const xLabel = x >= 0
      ? `Buy <strong>${fmtShares(x)}</strong> more YES shares`
      : `Sell <strong>${fmtShares(Math.abs(x))}</strong> YES shares`;
    const yLabel = y >= 0
      ? `Buy <strong>${fmtShares(y)}</strong> more NO shares`
      : `Sell <strong>${fmtShares(Math.abs(y))}</strong> NO shares`;

    const xCost = Math.abs(x * pLong);
    const yCost = Math.abs(y * pShort);

    out.innerHTML = `
      <div class="p1hedge-scenario">Scenario: capital ${fmt(capital)} allocated to reach Path 1 = $0</div>
      <div class="p1hedge-rows">
        <div class="p1hedge-row ${x >= 0 ? 'buy-yes' : 'warn'}">
          <span class="p1hedge-row-label">${xLabel} @ ${fmt(pLong, 4)}/share<br>
            <small>Cost: ${fmt(x >= 0 ? xCost : -xCost)} → total YES position: ${fmtShares(totalLong)} shares</small>
          </span>
          <span class="p1hedge-row-value ${colorClass(x)}">${x >= 0 ? '+' : '−'}${fmtShares(Math.abs(x))}</span>
        </div>
        <div class="p1hedge-row ${y >= 0 ? 'buy-no' : 'warn'}">
          <span class="p1hedge-row-label">${yLabel} @ ${fmt(pShort, 4)}/share<br>
            <small>Cost: ${fmt(y >= 0 ? yCost : -yCost)} → total NO position: ${fmtShares(totalShort)} shares</small>
          </span>
          <span class="p1hedge-row-value ${colorClass(y)}">${y >= 0 ? '+' : '−'}${fmtShares(Math.abs(y))}</span>
        </div>
        <div class="p1hedge-row info">
          <span class="p1hedge-row-label">Path 1 P&L after adjustment (should be $0.00)</span>
          <span class="p1hedge-row-value ${colorClass(checkPnl)}">${fmt(checkPnl)}</span>
        </div>
      </div>
      <div class="p1hedge-formula">
        <span class="hl">Breakeven condition:</span> n_yes × (1 − p_yes) = n_no × p_no<br>
        <span class="hlg">${fmtShares(totalLong)}</span> × ${payoff.toFixed(4)} = <span class="hlr">${fmtShares(totalShort)}</span> × ${pShort.toFixed(4)}<br>
        ${fmt(totalLong * payoff)} ≈ ${fmt(totalShort * pShort)}<br><br>
        <span class="hl">Capital system:</span><br>
        x·p_yes + y·p_no = capital<br>
        x = capital − n_yes_existing·(1−p_yes) + n_no_existing·p_no<br>
        x = ${fmt(capital)} − ${fmtShares(longShares)}×${payoff.toFixed(4)} + ${fmtShares(shortShares)}×${pShort.toFixed(4)}<br>
        x = <span class="hlg">${fmtShares(x)}</span><br>
        y = (capital − x·p_yes) / p_no = <span class="hlr">${fmtShares(y)}</span>
      </div>
    `;
    return;
  }

  // ── Case B: no capital, longShares known ──────────────────────────────────
  if (longShares > 0) {
    const noNeeded    = Math.floor(longShares * payoff / pShort);
    const noAdditional= noNeeded - shortShares;
    const checkPnl    = longShares * payoff - noNeeded * pShort;
    const yesLabel    = effectiveYesValue < 1.0
      ? `$${effectiveYesValue.toFixed(4)} (discounted)`
      : '$1.00';

    out.innerHTML = `
      <div class="p1hedge-scenario">Scenario: ${fmtShares(longShares)} YES shares held — calculating NO shares needed for Path 1 = $0</div>
      <div class="p1hedge-rows">
        <div class="p1hedge-row ${noAdditional >= 0 ? 'buy-no' : 'info'}">
          <span class="p1hedge-row-label">
            ${noAdditional >= 0
              ? `Buy <strong>${noAdditional}</strong> more NO shares @ ${fmt(pShort, 4)}/share`
              : `You already hold <strong>${Math.abs(noAdditional)}</strong> more NO shares than needed — consider trimming`
            }<br>
            <small>Target total NO position: ${noNeeded} shares
            ${noAdditional >= 0 ? ` · cost: ${fmt(noAdditional * pShort)}` : ''}</small>
          </span>
          <span class="p1hedge-row-value ${colorClass(noAdditional >= 0 ? 1 : -1)}">
            ${noAdditional >= 0 ? '+' : '−'}${Math.abs(noAdditional)} NO
          </span>
        </div>
        <div class="p1hedge-row info">
          <span class="p1hedge-row-label">Path 1 P&L after adjustment (slight positive from floor)</span>
          <span class="p1hedge-row-value ${colorClass(checkPnl)}">${fmt(checkPnl)}</span>
        </div>
      </div>
      <div class="p1hedge-formula">
        <span class="hl">Breakeven condition:</span> n_yes × (yes_eff − p_yes) = n_no × p_no<br>
        n_no = n_yes × (${yesLabel} − ${fmt(pLong, 4)}) / p_no<br>
        n_no = <span class="hlg">${fmtShares(longShares)}</span> × ${payoff.toFixed(4)} / ${pShort.toFixed(4)}<br>
        n_no = <span class="hlr">${noNeeded}</span> (floored — whole shares only)<br>
        Additional NO needed = ${noNeeded} − ${fmtShares(shortShares)} (held) = <span class="hlr">${noAdditional}</span>
      </div>
    `;
    return;
  }

  // ── Case C: no capital, shortShares known ─────────────────────────────────
  if (shortShares > 0) {
    const yesNeeded    = shortShares * pShort / payoff;
    const yesAdditional= yesNeeded - longShares;
    const checkPnl     = yesNeeded * payoff - shortShares * pShort;

    out.innerHTML = `
      <div class="p1hedge-scenario">Scenario: ${fmtShares(shortShares)} NO shares held — calculating YES shares needed for Path 1 = $0</div>
      <div class="p1hedge-rows">
        <div class="p1hedge-row ${yesAdditional >= 0 ? 'buy-yes' : 'info'}">
          <span class="p1hedge-row-label">
            ${yesAdditional >= 0
              ? `Buy <strong>${fmtShares(yesAdditional)}</strong> more YES shares @ ${fmt(pLong, 4)}/share`
              : `You already hold <strong>${fmtShares(Math.abs(yesAdditional))}</strong> more YES shares than needed — consider trimming`
            }<br>
            <small>Target total YES position: ${fmtShares(yesNeeded)} shares
            ${yesAdditional >= 0 ? ` · cost: ${fmt(yesAdditional * pLong)}` : ''}</small>
          </span>
          <span class="p1hedge-row-value ${colorClass(yesAdditional >= 0 ? 1 : -1)}">
            ${yesAdditional >= 0 ? '+' : '−'}${fmtShares(Math.abs(yesAdditional))} YES
          </span>
        </div>
        <div class="p1hedge-row info">
          <span class="p1hedge-row-label">Path 1 P&L after adjustment (should be $0.00)</span>
          <span class="p1hedge-row-value ${colorClass(checkPnl)}">${fmt(checkPnl)}</span>
        </div>
      </div>
      <div class="p1hedge-formula">
        <span class="hl">Breakeven condition:</span> n_yes × (1 − p_yes) = n_no × p_no<br>
        n_yes = n_no × p_no / (1 − p_yes)<br>
        n_yes = <span class="hlr">${fmtShares(shortShares)}</span> × ${pShort.toFixed(4)} / ${payoff.toFixed(4)}<br>
        n_yes = <span class="hlg">${fmtShares(yesNeeded)}</span><br>
        Additional YES needed = ${fmtShares(yesNeeded)} − ${fmtShares(longShares)} (held) = <span class="hlg">${fmtShares(yesAdditional)}</span>
      </div>
    `;
    return;
  }

  // ── No shares or capital entered yet ──────────────────────────────────────
  out.innerHTML = `
    <div class="p1hedge-rows">
      <div class="p1hedge-row info">
        <span class="p1hedge-row-label">
          Enter either <strong>available capital</strong> or at least one share amount to calculate the Path 1 breakeven hedge.
        </span>
      </div>
    </div>
  `;
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────

function switchMode(mode) {
  document.getElementById('modeCalc').classList.toggle('hidden',    mode !== 'calc');
  document.getElementById('modeCompare').classList.toggle('hidden', mode !== 'compare');
  document.getElementById('btnModeCalc').classList.toggle('active',  mode === 'calc');
  document.getElementById('btnModeComp').classList.toggle('active',  mode === 'compare');
  document.querySelector('.app').classList.toggle('compare-mode', mode === 'compare');
  if (mode === 'compare') renderTrackedPanel();
}

// ─── Comparison mode ──────────────────────────────────────────────────────────

// Markets list is defined in data/markets.json and injected by Hugo.
// Hugo jsonify on a root-array produces a string literal, so we parse if needed.
const PRESET_MARKETS = (() => {
  const raw = window.TRACKED_MARKETS;
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
})();
const POLYMARKET_BASE = 'https://polymarket.com/event/';
const GAMMA_API       = 'https://gamma-api.polymarket.com/events?slug=';

// ── Volume data (fetched at build time by Hugo, injected as window.MARKET_VOLUMES) ──

// window.MARKET_VOLUMES is a dict of slug → { volume, liquidity } injected at build time.
// Falls back to an empty object if unavailable (e.g. dev builds without network).
const MARKET_VOLUMES = (() => {
  const raw = window.MARKET_VOLUMES;
  if (!raw) return {};
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
})();

// Build-time price data: slug → [{title, yesPrice, noPrice}]
const MARKET_PRICES_RAW = (() => {
  const raw = window.MARKET_PRICES;
  if (!raw) return {};
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
})();

// Process raw price list into { yesPrice, noLegs } using the same date-sort logic.
// mktList items: { title, outcomePrices } (raw JSON string from build-time)
//             or { title, yesPrice, noPrice }  (already parsed, from live API path)
function processMarketPriceData(mktList) {
  if (!mktList || mktList.length === 0) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Parse and filter
  const parsed = mktList.flatMap(m => {
    try {
      let yp, np;
      if (m.outcomePrices != null) {
        const pp = JSON.parse(m.outcomePrices);
        yp = parseFloat(pp[0]);
        np = parseFloat(pp[1]);
      } else {
        yp = m.yesPrice;
        np = m.noPrice;
      }
      if (!isFinite(yp) || yp < 0.005 || yp > 0.995) return [];

      // Date: prefer title (groupItemTitle, reliable) over endDateIso (often wrong in Gamma API)
      let date = null;
      if (m.title) {
        date = parseTitleDate(m.title);
      }
      if (!date && m.endDateIso) {
        date = new Date(m.endDateIso + 'T00:00:00');
      }

      // Display title: groupItemTitle if present, else format endDateIso
      let title = m.title || '';
      if (!title && m.endDateIso) {
        const d = new Date(m.endDateIso + 'T00:00:00');
        title = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      return [{ title, yesPrice: yp, noPrice: np, date }];
    } catch { return []; }
  });

  if (parsed.length === 0) return null;
  if (parsed.length === 1) return { yesPrice: parsed[0].yesPrice, noLegs: [] };

  const dated   = parsed.filter(m => m.date).sort((a, b) => a.date - b.date);
  const undated = parsed.filter(m => !m.date);
  const sorted  = [...dated, ...undated];

  const yesMkt = sorted[sorted.length - 1];
  const yesDte = yesMkt.date ? Math.round((yesMkt.date - today) / 86400000) : null;
  const noLegs = sorted.slice(0, sorted.length - 1).map((m, idx) => {
    const expDate = m.date ? m.date.toISOString().slice(0, 10) : '';
    const dte     = m.date ? Math.round((m.date - today) / 86400000) : null;
    return { id: idx + 1, noPrice: m.noPrice, expDate, dte: dte > 0 ? dte : null, minNo: null };
  });
  return { yesPrice: yesMkt.yesPrice, yesDte: yesDte > 0 ? yesDte : null, noLegs };
}

// Pre-populate volume cache from build-time data so existing code paths work unchanged.
const volumeCache = {};
Object.entries(MARKET_VOLUMES).forEach(([slug, data]) => {
  volumeCache[slug] = typeof data === 'object' && data !== null ? (data.volume ?? null) : null;
});

// fetchVolume is kept for any custom-slug entries added by the user at runtime.
// For preset markets the build-time data is always used.
async function fetchVolume(slug) {
  if (slug in volumeCache) return volumeCache[slug];
  try {
    const res  = await fetch(GAMMA_API + encodeURIComponent(slug));
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const vol  = data && data.length > 0 ? parseFloat(data[0].volume ?? 0) : null;
    volumeCache[slug] = vol;
    return vol;
  } catch {
    volumeCache[slug] = null;
    return null;
  }
}

// Parse "March 31", "December 31", etc. → Date object
function parseTitleDate(title) {
  if (!title) return null;
  const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,
                   july:7,august:8,september:9,october:10,november:11,december:12 };
  const m = title.trim().match(/^(\w+)\s+(\d+)$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day  = parseInt(m[2]);
  const now  = new Date(); now.setHours(0,0,0,0);
  let year = now.getFullYear();
  let d = new Date(year, month - 1, day);
  if (d < now) d = new Date(++year, month - 1, day);
  return d;
}

// Returns { yesPrice, noLegs: [{noPrice, title, expDate, dte}] }
// slugOrSlugs can be a single slug string or array of slugs (for multi-event series).
// Furthest-out dated market = YES, all others = NO legs sorted asc.
async function fetchMarketPrices(slugOrSlugs) {
  const slugs = Array.isArray(slugOrSlugs) ? slugOrSlugs : [slugOrSlugs];
  try {
    const allMarkets = [];

    for (const slug of slugs) {
      const res = await fetch(GAMMA_API + encodeURIComponent(slug));
      if (!res.ok) continue;
      const events = await res.json();
      if (!events || events.length === 0) continue;
      const markets = events[0].markets;
      if (!markets) continue;

      for (const m of markets) {
        if (!m.outcomePrices) continue;
        try {
          const prices   = JSON.parse(m.outcomePrices);
          const outcomes = JSON.parse(m.outcomes || '["Yes","No"]');
          const yesIdx   = outcomes.findIndex(o => /yes/i.test(o));
          const noIdx    = outcomes.findIndex(o => /no/i.test(o));
          const yesPrice = parseFloat(prices[yesIdx >= 0 ? yesIdx : 0]);
          const noPrice  = parseFloat(prices[noIdx  >= 0 ? noIdx  : 1]);
          if (yesPrice < 0.005 || yesPrice > 0.995) continue;

          // Date: prefer groupItemTitle (reliable) over endDateIso (often wrong in Gamma API)
          let date = null;
          const endDateIso   = m.endDateIso    || '';
          const groupTitle   = m.groupItemTitle || '';
          if (groupTitle) {
            date = parseTitleDate(groupTitle);
          }
          if (!date && endDateIso) {
            date = new Date(endDateIso + 'T00:00:00');
          }

          // Display title
          let title = groupTitle;
          if (!title && endDateIso) {
            const d = new Date(endDateIso + 'T00:00:00');
            title = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }

          allMarkets.push({ yesPrice, noPrice, title, date });
        } catch {}
      }
    }

    if (allMarkets.length === 0) return null;
    if (allMarkets.length === 1) return { yesPrice: allMarkets[0].yesPrice, noLegs: [] };

    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const dated   = allMarkets.filter(p => p.date).sort((a, b) => a.date - b.date);
    const undated = allMarkets.filter(p => !p.date);
    const sorted  = [...dated, ...undated];

    const yesMkt = sorted[sorted.length - 1];
    const noMkts = sorted.slice(0, sorted.length - 1);
    const yesDte = yesMkt.date ? Math.round((yesMkt.date - today) / 86400000) : null;

    const noLegs = noMkts.map((m, idx) => {
      const expDate = m.date ? m.date.toISOString().slice(0, 10) : '';
      const dte     = m.date ? Math.round((m.date - today) / 86400000) : null;
      return { id: idx + 1, noPrice: m.noPrice, title: m.title, expDate, dte: dte > 0 ? dte : null };
    });

    return { yesPrice: yesMkt.yesPrice, yesDte: yesDte > 0 ? yesDte : null, noLegs };
  } catch {
    return null;
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const debouncedFetchPrices = debounce(autoFetchPrices, 800);

async function autoFetchPrices(entryId) {
  const entry = compEntries.find(e => e.id === entryId);
  if (!entry || !entry.slug) return;

  const btn      = document.getElementById(`comp-refresh-${entryId}`);
  const statusEl = document.getElementById(`comp-fetch-status-${entryId}`);

  if (btn)      { btn.disabled = true; btn.classList.add('spinning'); }
  if (statusEl) statusEl.textContent = 'Fetching…';

  // Try live API first (use all slugs for multi-event series); fall back to build-time data
  const slugs = [entry.slug, ...(entry.relatedSlugs || [])];
  let result = await fetchMarketPrices(slugs);
  let source  = 'live';

  if (!result && MARKET_PRICES_RAW[entry.slug]) {
    result = processMarketPriceData(MARKET_PRICES_RAW[entry.slug]);
    source  = 'build';
  }

  if (btn)      { btn.disabled = false; btn.classList.remove('spinning'); }

  if (!result) {
    if (statusEl) statusEl.textContent = 'Could not fetch prices';
    return;
  }

  // Update YES price and DTE
  entry.yesPrice = result.yesPrice;
  entry.yesDte   = result.yesDte ?? null;
  const yesInput = document.getElementById(`comp-yesprice-${entryId}`);
  if (yesInput) yesInput.value = result.yesPrice;

  // Replace NO legs if multi-market (keep existing legs if single-market)
  if (result.noLegs.length > 0) {
    entry.noLegs = result.noLegs.map((leg, idx) => ({
      id:      idx + 1,
      noPrice: leg.noPrice,
      expDate: leg.expDate,
      dte:     leg.dte,
      minNo:   null,
    }));
    entry.nextLegId = entry.noLegs.length + 1;

    const legList = document.getElementById(`comp-leg-list-${entryId}`);
    if (legList) {
      legList.innerHTML = entry.noLegs
        .map(leg => buildLegRowHTML(entryId, leg, entry.inputMode))
        .join('');
    }
  }

  if (statusEl) {
    const t        = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const legCount = result.noLegs.length;
    const legs     = legCount > 0 ? ` · ${legCount} NO leg${legCount > 1 ? 's' : ''}` : '';
    const src      = source === 'build' ? ' (build-time)' : '';
    statusEl.textContent = `${t}${legs}${src}`;
  }

  renderCompResults();
}

function fmtVolume(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(1) + 'k';
  return '$' + v.toFixed(0);
}

function updateVolumeEl(slug, vol) {
  document.querySelectorAll(`.vol-${CSS.escape(slug)}`).forEach(el => {
    el.textContent  = fmtVolume(vol);
    el.title        = vol != null ? '$' + vol.toLocaleString(undefined, {maximumFractionDigits:2}) + ' volume' : 'volume unavailable';
    el.classList.toggle('vol-loaded', vol != null);
  });
}

let compEntries = [];
let compNextId  = 1;

// ── Tracked markets panel ─────────────────────────────────────────────────────

let trackedPanelCollapsed = false;

function toggleTrackedPanel() {
  trackedPanelCollapsed = !trackedPanelCollapsed;
  const list = document.getElementById('trackedList');
  const btn  = document.getElementById('btnTrackedToggle');
  if (list) list.classList.toggle('hidden', trackedPanelCollapsed);
  if (btn)  btn.textContent = trackedPanelCollapsed ? '▸' : '▾';
}

function renderTrackedPanel() {
  const list = document.getElementById('trackedList');
  if (!list) return;
  list.innerHTML = '';

  const CATEGORY_ORDER = ['Geopolitics', 'Politics', 'AI & Tech', 'Finance & Crypto', 'Entertainment', 'Other'];

  // Group markets by category
  const byCategory = {};
  PRESET_MARKETS.forEach(m => {
    const cat = m.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  });

  // Sort within each category by volume descending (nulls last)
  Object.values(byCategory).forEach(arr => {
    arr.sort((a, b) => (volumeCache[b.slug] ?? -1) - (volumeCache[a.slug] ?? -1));
  });

  // Render in category order
  const categories = CATEGORY_ORDER.filter(c => byCategory[c]).concat(
    Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c))
  );

  categories.forEach(cat => {
    const header = document.createElement('div');
    header.className = 'tracked-category-header';
    header.textContent = cat;
    list.appendChild(header);

    byCategory[cat].forEach(m => {
      const alreadyAdded = compEntries.some(e => e.slug === m.slug);
      const volText      = (m.slug in volumeCache) ? fmtVolume(volumeCache[m.slug]) : '…';

      const row = document.createElement('div');
      row.className = 'tracked-row';
      row.id = `tracked-row-${m.slug}`;
      row.innerHTML = `
        <a class="tracked-name" href="${POLYMARKET_BASE}${m.slug}" target="_blank" rel="noopener">${m.name}</a>
        <span class="tracked-vol vol-${m.slug} ${(m.slug in volumeCache) ? 'vol-loaded' : ''}"
              title="Total market volume">${volText}</span>
        <button class="btn-tracked-add ${alreadyAdded ? 'added' : ''}"
          onclick="addPresetMarket('${m.slug}')"
          ${alreadyAdded ? 'disabled' : ''}>
          ${alreadyAdded ? 'Added' : '+ Compare'}
        </button>
      `;
      list.appendChild(row);

      // Build-time volumes are already in volumeCache; only fetch at runtime for custom slugs.
      if (!(m.slug in volumeCache)) {
        fetchVolume(m.slug).then(vol => updateVolumeEl(m.slug, vol));
      }
    });
  });
}

function addPresetMarket(slug) {
  const preset = PRESET_MARKETS.find(m => m.slug === slug);
  if (!preset) return;

  // Pre-populate prices from build-time data before the entry is rendered
  const buildPrices = MARKET_PRICES_RAW[slug] ? processMarketPriceData(MARKET_PRICES_RAW[slug]) : null;

  addMarketEntry(preset, buildPrices);
}

function refreshTrackedButtons() {
  PRESET_MARKETS.forEach(m => {
    const btn = document.querySelector(`#tracked-row-${m.slug} .btn-tracked-add`);
    if (!btn) return;
    const added = compEntries.some(e => e.slug === m.slug);
    btn.textContent  = added ? 'Added' : '+ Compare';
    btn.disabled     = added;
    btn.className    = `btn-tracked-add ${added ? 'added' : ''}`;
  });
}

// ── Add / Remove (no full re-render — just append / remove the one element) ──

function addMarketEntry(preset = null, buildPrices = null) {
  const id    = compNextId++;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const defaultDate = `${today.getFullYear()}-12-31`;
  const defaultDte  = Math.round((new Date(defaultDate + 'T00:00:00') - today) / 86400000);

  // Start with build-time prices if available, else blank defaults
  const yesPrice = buildPrices ? buildPrices.yesPrice : null;
  const noLegs   = buildPrices && buildPrices.noLegs.length > 0
    ? buildPrices.noLegs.map((l, i) => ({ ...l, id: i + 1, minNo: null }))
    : [{ id: 1, noPrice: null, expDate: defaultDate, dte: defaultDte > 0 ? defaultDte : null, minNo: null }];

  const entry = {
    id,
    name:         preset ? preset.name : '',
    slug:         preset ? preset.slug : '',
    relatedSlugs: preset ? (preset.relatedSlugs || []) : [],
    yesPrice,
    yesDte:    buildPrices ? buildPrices.yesDte : null,
    thetaDrop: 10,
    thetaDays: 180,
    inputMode: 'capital', capital: 100, minYes: null,
    noLegs,
    nextLegId: noLegs.length + 1,
  };
  compEntries.push(entry);
  const statusNote = buildPrices ? '(build-time)' : '';
  document.getElementById('compEntries').appendChild(buildEntryEl(entry, compEntries.length, statusNote));
  refreshTrackedButtons();
  renderCompResults();
}

function removeMarketEntry(id) {
  compEntries = compEntries.filter(e => e.id !== id);
  const el = document.getElementById(`comp-entry-${id}`);
  if (el) el.remove();
  // Re-number remaining entries
  compEntries.forEach((e, idx) => {
    const n = document.querySelector(`#comp-entry-${e.id} .comp-entry-num`);
    if (n) n.textContent = `#${idx + 1}`;
  });
  refreshTrackedButtons();
  renderCompResults();
}

// ── Field updates (never re-render the card, only update results table) ──────

function updateEntrySlug(id, slug) {
  const entry = compEntries.find(e => e.id === id);
  if (!entry) return;
  entry.slug = slug.trim();
  // Update the link in the card header
  const header = document.querySelector(`#comp-entry-${id} .comp-entry-header`);
  if (header) {
    const existing = header.querySelector('.comp-poly-link');
    if (existing) existing.remove();
    if (entry.slug) {
      const a = document.createElement('a');
      a.className   = 'comp-poly-link';
      a.href        = POLYMARKET_BASE + entry.slug;
      a.target      = '_blank';
      a.rel         = 'noopener';
      a.title       = 'View on Polymarket';
      a.textContent = '↗ Polymarket';
      // Insert before the remove button
      const removeBtn = header.querySelector('.btn-remove-entry');
      header.insertBefore(a, removeBtn);
    }
  }
  refreshTrackedButtons();
  renderCompResults();
  // Auto-fetch prices whenever a valid slug is entered
  if (entry.slug) debouncedFetchPrices(entry.id);
}

function updateEntry(id, field, rawValue) {
  const entry = compEntries.find(e => e.id === id);
  if (!entry) return;
  if (field === 'name') {
    entry.name = rawValue;
    const el = document.getElementById(`comp-name-preview-${id}`);
    if (el) el.textContent = rawValue || `Market ${id}`;
  } else {
    const v = parseFloat(rawValue);
    entry[field] = isNaN(v) ? null : v;
  }
  // Refresh computed theta display when either theta field changes
  if (field === 'thetaDrop' || field === 'thetaDays') {
    const drop = entry.thetaDrop ?? 10;
    const days = entry.thetaDays ?? 180;
    const el = document.getElementById(`comp-theta-${id}`);
    if (el) el.textContent = days > 0
      ? `= ×${Math.pow(1 - drop/100, 1/days).toFixed(6)}/day`
      : '= —';
  }
  renderCompResults();
}

function addLeg(entryId) {
  const entry = compEntries.find(e => e.id === entryId);
  if (!entry) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const defaultDate = `${today.getFullYear()}-12-31`;
  const defaultDte  = Math.round((new Date(defaultDate + 'T00:00:00') - today) / 86400000);
  const leg = { id: entry.nextLegId++, noPrice: null, expDate: defaultDate, dte: defaultDte > 0 ? defaultDte : null, minNo: null };
  entry.noLegs.push(leg);
  const list = document.getElementById(`comp-leg-list-${entryId}`);
  if (list) list.insertAdjacentHTML('beforeend', buildLegRowHTML(entryId, leg, entry.inputMode));
  renderCompResults();
}

function removeLeg(entryId, legId) {
  const entry = compEntries.find(e => e.id === entryId);
  if (!entry || entry.noLegs.length <= 1) return;  // keep at least one
  entry.noLegs = entry.noLegs.filter(l => l.id !== legId);
  document.getElementById(`comp-leg-${entryId}-${legId}`)?.remove();
  renderCompResults();
}

function updateLeg(entryId, legId, field, rawValue) {
  const entry = compEntries.find(e => e.id === entryId);
  if (!entry) return;
  const leg = entry.noLegs.find(l => l.id === legId);
  if (!leg) return;
  const v = parseFloat(rawValue);
  leg[field] = isNaN(v) ? null : v;
  renderCompResults();
}

function updateLegDate(entryId, legId, dateStr) {
  const entry = compEntries.find(e => e.id === entryId);
  if (!entry) return;
  const leg = entry.noLegs.find(l => l.id === legId);
  if (!leg) return;
  leg.expDate = dateStr;
  if (dateStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff  = Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
    leg.dte     = diff > 0 ? diff : null;
    const dteEl = document.getElementById(`comp-dte-${entryId}-${legId}`);
    if (dteEl) dteEl.textContent = leg.dte ? `${leg.dte} days` : 'date in the past';
  } else {
    leg.dte = null;
    const dteEl = document.getElementById(`comp-dte-${entryId}-${legId}`);
    if (dteEl) dteEl.textContent = '';
  }
  renderCompResults();
}

// ── Mode toggle (only re-renders the variable-fields section of one card) ────

function setEntryInputMode(id, mode) {
  const entry = compEntries.find(e => e.id === id);
  if (!entry) return;
  entry.inputMode = mode;
  // Swap active button
  const entryEl = document.getElementById(`comp-entry-${id}`);
  if (!entryEl) return;
  entryEl.querySelectorAll('.comp-mode-opt').forEach(b => b.classList.remove('active'));
  entryEl.querySelectorAll('.comp-mode-opt').forEach(b => {
    if (b.dataset.mode === mode) b.classList.add('active');
  });
  // Swap variable fields
  const varEl = entryEl.querySelector('.comp-var-fields');
  if (varEl) varEl.innerHTML = buildVarFields(entry);
  // Rebuild leg rows (shows/hides Min NO field)
  const legList = document.getElementById(`comp-leg-list-${id}`);
  if (legList) legList.innerHTML = entry.noLegs.map(leg => buildLegRowHTML(id, leg, mode)).join('');
  renderCompResults();
}

// ── Build helpers ─────────────────────────────────────────────────────────────

function buildVarFields(e) {
  if (e.inputMode === 'capital') {
    return `
      <div class="comp-field">
        <label>Capital to Invest</label>
        <div class="input-wrap"><span class="prefix">$</span>
          <input type="number" placeholder="100.00" min="0" step="0.01"
            value="${e.capital ?? 100}"
            oninput="updateEntry(${e.id},'capital',this.value)" />
        </div>
      </div>`;
  }
  return `
    <div class="comp-field">
      <label>Min YES Shares <small>(rewards)</small></label>
      <div class="input-wrap">
        <input type="number" placeholder="0" min="0" step="1"
          value="${e.minYes ?? ''}"
          oninput="updateEntry(${e.id},'minYes',this.value)" />
      </div>
    </div>`;
}

function buildLegRowHTML(entryId, leg, inputMode) {
  const minNoField = inputMode === 'minShares' ? `
        <div class="comp-field comp-leg-field">
          <label>Min NO</label>
          <div class="input-wrap">
            <input type="number" placeholder="0" min="0" step="1"
              value="${leg.minNo ?? ''}"
              oninput="updateLeg(${entryId},${leg.id},'minNo',this.value)" />
          </div>
        </div>` : '';

  return `
    <div class="comp-leg-row" id="comp-leg-${entryId}-${leg.id}">
      <div class="comp-leg-fields">
        <div class="comp-field comp-leg-field">
          <label>NO Price</label>
          <div class="input-wrap"><span class="prefix">$</span>
            <input type="number" placeholder="0.55" min="0.001" max="0.999" step="0.001"
              id="comp-noprice-${entryId}-${leg.id}"
              value="${leg.noPrice ?? ''}"
              oninput="updateLeg(${entryId},${leg.id},'noPrice',this.value)" />
          </div>
        </div>
        ${minNoField}
        <div class="comp-field comp-leg-field">
          <label>Expiration</label>
          <div class="input-wrap">
            <input type="date"
              value="${leg.expDate ?? ''}"
              oninput="updateLegDate(${entryId},${leg.id},this.value)" />
          </div>
          <span class="field-hint" id="comp-dte-${entryId}-${leg.id}" style="color:var(--neutral)">${leg.dte ? leg.dte + ' days' : ''}</span>
        </div>
      </div>
      <button class="btn-remove-leg" onclick="removeLeg(${entryId},${leg.id})" title="Remove NO leg">✕</button>
    </div>`;
}

function buildEntryEl(e, num, initialStatus = '') {
  const wrap = document.createElement('div');
  wrap.className = 'comp-entry';
  wrap.id = `comp-entry-${e.id}`;

  const polyLink = e.slug
    ? `<a class="comp-poly-link" href="${POLYMARKET_BASE}${e.slug}" target="_blank" rel="noopener" title="View on Polymarket">↗ Polymarket</a>`
    : '';

  wrap.innerHTML = `
    <div class="comp-entry-header">
      <span class="comp-entry-num">#${num}</span>
      <span class="comp-entry-name-preview" id="comp-name-preview-${e.id}">${e.name || `Market ${e.id}`}</span>
      ${polyLink}
      <span class="comp-fetch-status" id="comp-fetch-status-${e.id}">${initialStatus}</span>
      <button class="btn-fetch-prices" id="comp-refresh-${e.id}" onclick="autoFetchPrices(${e.id})" title="Fetch live prices from Polymarket">↻ Prices</button>
      <button class="btn-remove-entry" onclick="removeMarketEntry(${e.id})" title="Remove">✕</button>
    </div>
    <div class="comp-entry-body">
      <div class="comp-entry-grid">

        <div class="comp-field" style="grid-column:1/-1">
          <label>Market Name</label>
          <div class="input-wrap">
            <input type="text" placeholder="e.g. Netanyahu out before 2027"
              value="${e.name}"
              oninput="updateEntry(${e.id},'name',this.value)" />
          </div>
        </div>

        <div class="comp-field" style="grid-column:1/-1">
          <label>Polymarket Slug <small style="font-weight:400;text-transform:none">(optional — enables link)</small></label>
          <div class="input-wrap">
            <input type="text" placeholder="e.g. netanyahu-out-before-2027"
              value="${e.slug}"
              oninput="updateEntrySlug(${e.id},this.value)" />
          </div>
        </div>

        <div class="comp-field">
          <label>YES Price</label>
          <div class="input-wrap"><span class="prefix">$</span>
            <input type="number" placeholder="0.45" min="0.001" max="0.999" step="0.001"
              id="comp-yesprice-${e.id}"
              value="${e.yesPrice ?? ''}"
              oninput="updateEntry(${e.id},'yesPrice',this.value)" />
          </div>
        </div>

        <div class="comp-field" style="grid-column:1/-1">
          <label>Long Side Theta <small style="font-weight:400;text-transform:none">(YES price decay)</small></label>
          <div class="theta-row">
            <div class="input-wrap">
              <input type="number" placeholder="10" min="0" max="100" step="1"
                value="${e.thetaDrop ?? 10}"
                oninput="updateEntry(${e.id},'thetaDrop',this.value)" />
              <span class="suffix">%</span>
            </div>
            <span class="theta-over">decay over</span>
            <div class="input-wrap">
              <input type="number" placeholder="180" min="1" step="1"
                value="${e.thetaDays ?? 180}"
                oninput="updateEntry(${e.id},'thetaDays',this.value)" />
            </div>
            <span class="theta-over">days</span>
            <span class="theta-computed" id="comp-theta-${e.id}">= ×${Math.pow(1 - (e.thetaDrop ?? 10)/100, 1/(e.thetaDays ?? 180)).toFixed(6)}/day</span>
          </div>
        </div>

        <div class="comp-mode-row">
          <span class="comp-mode-label">Input mode:</span>
          <div class="comp-mode-options">
            <button class="comp-mode-opt ${e.inputMode === 'capital'   ? 'active' : ''}"
              data-mode="capital"   onclick="setEntryInputMode(${e.id},'capital')">Capital</button>
            <button class="comp-mode-opt ${e.inputMode === 'minShares' ? 'active' : ''}"
              data-mode="minShares" onclick="setEntryInputMode(${e.id},'minShares')">Min Shares</button>
          </div>
        </div>

        <div class="comp-var-fields">
          ${buildVarFields(e)}
        </div>

      </div>

      <div class="comp-no-legs">
        <div class="comp-no-legs-header">
          <span class="comp-no-legs-title">NO Positions</span>
          <button class="btn-add-leg" onclick="addLeg(${e.id})">+ Add NO</button>
        </div>
        <div class="comp-leg-list" id="comp-leg-list-${e.id}">
          ${e.noLegs.map(leg => buildLegRowHTML(e.id, leg, e.inputMode)).join('')}
        </div>
      </div>

    </div>`;
  return wrap;
}

// ── Calculate one entry ───────────────────────────────────────────────────────
//
// Share allocation uses Path 1 breakeven split:
//   n_yes × (1 − p_yes) = n_no × p_no
//
// Capital mode  → n_yes = capital, n_no = capital × (1 − p_yes) / p_no
// Min shares    → binding constraint determines the anchor, other leg solved
//
// Path 2 P&L   = n_no × (1 − p_no)           [NO pays $1, YES flat]
// Path 2 ROI   = path2Pnl / totalCost
// Ann. ROI     = path2Roi × 365 / dte

function calcEntry(entry, leg) {
  const { yesPrice: pY, yesDte, thetaDrop = 10, thetaDays = 180, inputMode, capital, minYes } = entry;
  // Per-day multiplicative decay factor
  const longTheta = thetaDays > 0 ? Math.pow(1 - thetaDrop / 100, 1 / thetaDays) : 1;
  const { noPrice: pN, dte, minNo } = leg;
  if (!pY || !pN || pY <= 0 || pY >= 1 || pN <= 0 || pN >= 1) return null;

  // Time-value discount: YES pays ~$1 at expiry but less if sold early (4% APR)
  const effectiveYesValue = yesDte && yesDte > 0 ? 1 - 0.04 * yesDte / 365 : 1.0;
  const payoff = effectiveYesValue - pY; // net YES payout per share
  if (payoff <= 0) return null; // degenerate: discount exceeds price gap

  let nYes, nNo;

  if (inputMode === 'capital') {
    if (!capital || capital <= 0) return null;
    nYes = capital;
    nNo  = Math.floor(capital * payoff / pN);
  } else {
    const hasYes = minYes != null && minYes > 0;
    const hasNo  = minNo  != null && minNo  > 0;
    if (!hasYes && !hasNo) return null;

    if (hasYes && hasNo) {
      const nNoFromYes = Math.floor(minYes * payoff / pN);
      const nYesFromNo = minNo  * pN    / payoff;
      if (nNoFromYes >= minNo) { nYes = minYes; nNo = nNoFromYes; }
      else                     { nYes = nYesFromNo; nNo = minNo; }
    } else if (hasYes) {
      nYes = minYes;
      nNo  = Math.floor(minYes * payoff / pN);
    } else {
      nNo  = minNo;
      nYes = minNo * pN / payoff;
    }
  }

  const totalCost = nYes * pY + nNo * pN;

  // Path 2: NO pays $1; YES decays multiplicatively by longTheta^dte
  const decayMult       = longTheta < 1 && dte ? Math.pow(longTheta, dte) : 1;
  const yesPriceAtNoRes = pY * decayMult;
  const path2Pnl        = nNo * (1 - pN) + nYes * (yesPriceAtNoRes - pY);
  const path2Roi        = totalCost > 0 ? path2Pnl / totalCost : 0;
  const annRoi          = dte && dte > 0 ? path2Roi * 365 / dte : null;

  // Sentiment change breakeven: max YES drop before NO profit no longer covers YES loss
  const sentimentBreakevenDrop = nYes > 0 ? (nNo * (1 - pN)) / nYes : null;
  const thetaDecay = pY - yesPriceAtNoRes;

  return { nYes, nNo, totalCost, path2Pnl, path2Roi, annRoi, thetaDecay, sentimentBreakevenDrop };
}

function renderCompResults() {
  const rows = [];
  compEntries.forEach(entry => {
    entry.noLegs.forEach(leg => {
      const calc = calcEntry(entry, leg);
      if (calc) rows.push({ entry, leg, calc });
    });
  });

  const wrap = document.getElementById('compResultsWrap');
  if (rows.length === 0) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  rows.sort((a, b) => {
    const ar = a.calc.annRoi ?? -Infinity;
    const br = b.calc.annRoi ?? -Infinity;
    return br - ar;
  });

  const tbody = document.getElementById('compTableBody');
  tbody.innerHTML = '';

  rows.forEach((r, idx) => {
    const { entry: e, leg, calc: c } = r;
    const isTop = idx === 0;
    const tr = document.createElement('tr');
    if (isTop) tr.classList.add('rank-1');

    const annStr = c.annRoi != null
      ? `<span class="ann-roi-val ${colorClass(c.annRoi)}">${fmtPct(c.annRoi)}</span>`
      : '<span class="ann-roi-val">—</span>';

    const nameCell = e.slug
      ? `<td class="market-name"><a href="${POLYMARKET_BASE}${e.slug}" target="_blank" rel="noopener" class="market-link">${e.name || `Market ${e.id}`} ↗</a></td>`
      : `<td class="market-name">${e.name || `Market ${e.id}`}</td>`;

    const cachedVol = volumeCache[e.slug];
    const volCell   = e.slug
      ? `<td><span class="vol-${e.slug} ${(e.slug in volumeCache) ? 'vol-loaded' : ''}" style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text-muted)">${(e.slug in volumeCache) ? fmtVolume(cachedVol) : '…'}</span></td>`
      : `<td style="color:var(--text-subtle)">—</td>`;

    if (e.slug && !(e.slug in volumeCache)) {
      fetchVolume(e.slug).then(vol => updateVolumeEl(e.slug, vol));
    }

    const sentDrop = c.sentimentBreakevenDrop;
    const sentCell = sentDrop != null
      ? `<span class="${colorClass(sentDrop)}">${fmt(sentDrop, 4)}</span>${c.thetaDecay > 0 ? `<br><small style="color:var(--text-subtle)">θ−${fmt(c.thetaDecay,4)}</small>` : ''}`
      : '—';

    const yesCost = c.nYes * (e.yesPrice ?? 0);
    const noCost  = c.nNo  * (leg.noPrice ?? 0);

    tr.innerHTML = `
      ${nameCell}
      ${volCell}
      <td>${fmtShares(c.nYes)}</td>
      <td>${fmt(yesCost)}</td>
      <td>${fmtShares(c.nNo)}</td>
      <td>${fmt(noCost)}</td>
      <td>${fmt(c.totalCost)}</td>
      <td class="${colorClass(c.path2Pnl)}">${fmt(c.path2Pnl)}</td>
      <td class="${colorClass(c.path2Roi)}">${fmtPct(c.path2Roi)}</td>
      <td>${leg.dte ?? '—'}</td>
      <td class="${isTop ? 'best-roi' : ''}">${annStr}</td>
      <td>${sentCell}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

['capital', 'longPrice', 'longShares', 'longThetaDrop', 'longThetaDays', 'longExpDate', 'shortPrice', 'shortShares', 'shortExpDate'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    calculate();
    renderP1Hedge();
  });
});

// Run once on load in case inputs are pre-filled
calculate();
