"""Reproduce descriptive screening metrics; this is not a trading backtest."""
import csv, json, math, statistics
from pathlib import Path
from datetime import date, timedelta

root = Path(__file__).resolve().parent
groups = {}
for row in csv.DictReader((root / 'history-2026-10-02.csv').open()):
    groups.setdefault(row['symbol'], []).append({k: float(row[k]) for k in ['close','high','low','volume']} | {'date': row['date']})
results = {}
for symbol, rows in groups.items():
    rows.sort(key=lambda r: r['date'])
    last = rows[-1]; end = date.fromisoformat(last['date'])
    def trailing(days):
        prior = [r for r in rows if date.fromisoformat(r['date']) <= end-timedelta(days=days)]
        return 100*(last['close']/prior[-1]['close']-1) if prior else None
    year = [r for r in rows if date.fromisoformat(r['date']) >= end-timedelta(days=365)]
    returns = [b['close']/a['close']-1 for a,b in zip(year,year[1:])]
    peak = year[0]['close']; drawdown = 0
    for r in year:
        peak = max(peak,r['close']); drawdown = min(drawdown,r['close']/peak-1)
    tr = [max(b['high']-b['low'],abs(b['high']-a['close']),abs(b['low']-a['close'])) for a,b in zip(rows,rows[1:])]
    results[symbol] = dict(bars=len(rows),first=rows[0]['date'],last=last['date'],close=last['close'],
        return30=trailing(30),return90=trailing(90),return365=trailing(365),
        vol=100*statistics.stdev(returns)*math.sqrt(365 if '/' in symbol else 252),
        maxDrawdown=100*drawdown,worstDay=100*min(returns),
        atr14Pct=100*statistics.mean(tr[-14:])/last['close'],
        dollarVolume20=statistics.mean(r['close']*r['volume'] for r in rows[-20:]) if '/' not in symbol else None)
# Stock close-to-close return correlations over common trading dates in the last year.
stock_returns = {}
for s,rows in groups.items():
    if '/' in s: continue
    stock_returns[s]={b['date']:b['close']/a['close']-1 for a,b in zip(rows,rows[1:]) if b['date']>='2025-10-02'}
correlations={}
for s,v in stock_returns.items():
    common=sorted(v.keys() & stock_returns['SPY'].keys())
    correlations[s]=statistics.correlation([v[d] for d in common],[stock_returns['SPY'][d] for d in common])
out={'asOf':'2026-10-02','source':'Alpaca SIP daily stock bars, adjustment=all; Alpaca US crypto daily bars',
     'method':'Calendar 30/90/365-day close returns; one-year close drawdown; annualized sample daily-return volatility; simple 14-session true-range average / latest close; 20-session close*volume proxy. Stock/crypto annualization 252/365. Descriptive only, no strategy tested.',
     'metrics':results,'stockCorrelationToSPY':correlations}
(root/'metrics-2026-10-02.json').write_text(json.dumps(out,indent=2)+'\n')
for s,m in results.items():
    print(f"{s:8} 1y={m['return365']:7.1f}% vol={m['vol']:5.1f}% DD={m['maxDrawdown']:6.1f}% ATR={m['atr14Pct']:4.1f}% DV20={(m['dollarVolume20'] or 0)/1e6:7.1f}m corr={correlations.get(s,0):.2f}")
