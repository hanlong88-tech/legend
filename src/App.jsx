import { useState, useRef, useEffect, useCallback } from "react";

/* ─── 颜色 ───────────────────────────────────────────────────────── */
const SWATCHES = [
  "#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6",
  "#06B6D4","#84CC16","#F97316","#EC4899","#14B8A6",
  "#6366F1","#FBBF24","#A78BFA","#FB923C","#34D399",
];

/* ─── 初始数据 ────────────────────────────────────────────────────── */
const DEFAULT_MATS = [
  { id:"m1", name:"刨花板 15-46-2", gW:1220, gH:1830, trim:5, kerf:4.6, price:23.25 },
  { id:"m2", name:"刨花板 15-48-1", gW:1220, gH:2440, trim:5, kerf:4.6, price:25.25 },
  { id:"m3", name:"MDF 2.5mm",      gW:1220, gH:1830, trim:5, kerf:4.6, price:9.21  },
];
const DEFAULT_PIECES = [
  { id:"p1", name:"侧板 L/R",   w:480, h:1800, qty:2, grain:"with",    matId:"m1", col:SWATCHES[0] },
  { id:"p2", name:"门板",       w:397, h:1720, qty:3, grain:"with",    matId:"m1", col:SWATCHES[1] },
  { id:"p3", name:"中板",       w:480, h:1690, qty:1, grain:"with",    matId:"m1", col:SWATCHES[2] },
  { id:"p4", name:"脚柱",       w:80,  h:1170, qty:2, grain:"free",    matId:"m1", col:SWATCHES[3] },
  { id:"p5", name:"顶/底板",    w:480, h:1170, qty:2, grain:"with",    matId:"m2", col:SWATCHES[4] },
  { id:"p6", name:"主层板",     w:400, h:770,  qty:1, grain:"with",    matId:"m2", col:SWATCHES[5] },
  { id:"p7", name:"侧层板",     w:400, h:385,  qty:3, grain:"free",    matId:"m2", col:SWATCHES[6] },
  { id:"p8", name:"背撑",       w:78,  h:770,  qty:1, grain:"free",    matId:"m2", col:SWATCHES[7] },
  { id:"p9", name:"背板",       w:400, h:1720, qty:3, grain:"with",    matId:"m3", col:SWATCHES[8] },
];

/* ─── localStorage 持久化 ─────────────────────────────────────────── */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

/* ─── 排版算法 ───────────────────────────────────────────────────── */
function orientations(pw, ph, grain) {
  const n = { pw, ph, rot: false }, r = { pw: ph, ph: pw, rot: true };
  if (grain === "with")    return [n];
  if (grain === "against") return [r];
  if (pw === ph)           return [n];
  return [n, r];
}

function packBoards(items, uw, uh, kerf) {
  const boards = [];
  let rem = [...items].sort((a, b) => b.pw * b.ph - a.pw * a.ph);
  let guard = 0;
  while (rem.length > 0 && guard++ < 8000) {
    const slots = [{ x: 0, y: 0, w: uw, h: uh }];
    const placed = [], left = [];
    for (const item of rem) {
      let bi = -1, bs = Infinity, bx = 0, by = 0, bpw = 0, bph = 0, brot = false;
      for (let si = 0; si < slots.length; si++) {
        const s = slots[si];
        for (const { pw, ph, rot } of orientations(item.pw, item.ph, item.grain)) {
          if (pw + kerf <= s.w + 0.01 && ph + kerf <= s.h + 0.01) {
            const sc = s.y * 100000 + s.x;
            if (sc < bs) { bs = sc; bi = si; bx = s.x; by = s.y; bpw = pw; bph = ph; brot = rot; }
          }
        }
      }
      if (bi < 0) { left.push(item); continue; }
      placed.push({ ...item, x: bx, y: by, w: bpw, h: bph, rotated: brot });
      const s = slots[bi];
      const rW = s.w - bpw - kerf, tH = s.h - bph - kerf, ns = [];
      if (rW > kerf) ns.push({ x: bx + bpw + kerf, y: by,           w: rW,  h: bph + kerf });
      if (tH > kerf) ns.push({ x: bx,              y: by + bph + kerf, w: s.w, h: tH });
      slots.splice(bi, 1, ...ns);
      slots.sort((a, b) => a.y - b.y || a.x - b.x);
    }
    boards.push({ placed, usedArea: placed.reduce((s, p) => s + p.w * p.h, 0) });
    if (left.length === rem.length) break;
    rem = left;
  }
  return boards;
}

function runOptimize(mats, pieces, qty) {
  const out = {};
  for (const mat of mats) {
    const uw = mat.gW - 2 * mat.trim, uh = mat.gH - 2 * mat.trim;
    const mp = pieces.filter(p => p.matId === mat.id);
    if (!mp.length) { out[mat.id] = null; continue; }
    const exp = mp.flatMap(p =>
      Array.from({ length: p.qty * qty }, (_, i) => ({ ...p, pw: p.w, ph: p.h, uid: `${p.id}_${i}` }))
    );
    const boards = packBoards(exp, uw, uh, mat.kerf);
    const used = boards.reduce((s, b) => s + b.usedArea, 0), ba = uw * uh;
    out[mat.id] = {
      boards, uw, uh,
      n: boards.length,
      avgUsage: boards.length ? (used / (boards.length * ba)) * 100 : 0,
      cost: boards.length * mat.price,
      placed: boards.reduce((s, b) => s + b.placed.length, 0),
      needed: exp.length,
    };
  }
  return out;
}

/* ─── SVG 排版图 ─────────────────────────────────────────────────── */
function BoardDiagram({ board, mat, uw, uh, idx, total }) {
  const VW = 210, M = 24, sc = (VW - M) / mat.gW, VH = mat.gH * sc + M + 6;
  const ox = 20, oy = 5;
  const pct = board.usedArea / (uw * uh) * 100;
  const uc  = pct >= 88 ? "#10B981" : pct >= 70 ? "#F59E0B" : "#EF4444";
  const pid = `hatch_${mat.id}_${idx}`;
  return (
    <svg width={VW} height={VH} style={{ display: "block" }}>
      <defs>
        <pattern id={pid} patternUnits="userSpaceOnUse" width="7" height="7">
          <path d="M-1,1l2,-2M0,7l7,-7M6,8l2,-2" stroke="#EF4444" strokeWidth="0.75" opacity="0.5" />
        </pattern>
      </defs>
      {/* 毛板 */}
      <rect x={ox} y={oy} width={mat.gW * sc} height={mat.gH * sc} fill="#111827" stroke="#374151" strokeWidth="1.2" rx="2" />
      {/* 修边区 */}
      {[[ox,oy,mat.trim*sc,mat.gH*sc],[ox+(mat.gW-mat.trim)*sc,oy,mat.trim*sc,mat.gH*sc],
        [ox,oy,mat.gW*sc,mat.trim*sc],[ox,oy+(mat.gH-mat.trim)*sc,mat.gW*sc,mat.trim*sc]
      ].map(([x,y,w,h],i) => <rect key={i} x={x} y={y} width={w} height={h} fill={`url(#${pid})`} opacity="0.9" />)}
      {/* 净料区 */}
      <rect x={ox+mat.trim*sc} y={oy+mat.trim*sc} width={uw*sc} height={uh*sc} fill="#1a2035" stroke="#2d3a55" strokeWidth="0.8" />
      {/* 网格 */}
      {[200,400,600,800,1000].filter(v=>v<uw).map(x=>(
        <line key={x} x1={ox+mat.trim*sc+x*sc} y1={oy+mat.trim*sc} x2={ox+mat.trim*sc+x*sc} y2={oy+mat.trim*sc+uh*sc} stroke="#1e2b40" strokeWidth="0.5"/>
      ))}
      {[200,400,600,800,1000,1200,1400,1600,1800,2000,2200].filter(v=>v<uh).map(y=>(
        <line key={y} x1={ox+mat.trim*sc} y1={oy+mat.trim*sc+y*sc} x2={ox+mat.trim*sc+uw*sc} y2={oy+mat.trim*sc+y*sc} stroke="#1e2b40" strokeWidth="0.5"/>
      ))}
      {/* 零件 */}
      {board.placed.map((p, i) => {
        const px=ox+mat.trim*sc+p.x*sc, py=oy+mat.trim*sc+p.y*sc, pw=p.w*sc, ph=p.h*sc;
        const cx=px+pw/2, cy=py+ph/2, fs=Math.max(5.5, Math.min(8.5, pw/4.5, ph/5));
        const gv=(p.grain==="with"&&!p.rotated)||(p.grain==="against"&&p.rotated);
        const al=Math.min(ph*0.26,8), aw=al*0.38;
        return (
          <g key={i}>
            {p.x+p.w<uw-0.5&&<rect x={px+pw} y={py} width={Math.min(mat.kerf*sc,1.8)} height={ph} fill="#EF4444" opacity="0.38"/>}
            {p.y+p.h<uh-0.5&&<rect x={px} y={py+ph} width={pw} height={Math.min(mat.kerf*sc,1.8)} fill="#EF4444" opacity="0.38"/>}
            <rect x={px} y={py} width={pw} height={ph} fill={p.col} fillOpacity="0.83" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" rx="1"/>
            {p.grain!=="free"&&ph>11&&pw>7&&(gv
              ?<path d={`M${cx},${cy-al}L${cx},${cy+al}M${cx-aw},${cy+al-aw*1.5}L${cx},${cy+al}L${cx+aw},${cy+al-aw*1.5}`} stroke="rgba(255,255,255,0.65)" strokeWidth="0.9" fill="none"/>
              :<path d={`M${cx-al},${cy}L${cx+al},${cy}M${cx+al-aw*1.5},${cy-aw}L${cx+al},${cy}L${cx+al-aw*1.5},${cy+aw}`} stroke="rgba(255,255,255,0.65)" strokeWidth="0.9" fill="none"/>
            )}
            {pw>13&&ph>7&&<text x={cx} y={cy+(ph>12?-fs*0.45:0)} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight="700" fill="white" style={{filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.9))"}}>{p.name.length>9?p.name.slice(0,8)+"…":p.name}</text>}
            {ph>12&&pw>13&&<text x={cx} y={cy+fs*0.85} textAnchor="middle" fontSize={Math.max(4.5,fs*0.72)} fill="rgba(255,255,255,0.6)">{p.w}×{p.h}</text>}
          </g>
        );
      })}
      <text x={ox} y={VH-2} fontSize="7" fill="#4B5563">#{idx+1}/{total}·{board.placed.length}件</text>
      <text x={ox+mat.gW*sc} y={VH-2} textAnchor="end" fontSize="7.5" fontWeight="700" fill={uc}>{pct.toFixed(1)}%</text>
      <text x={ox+mat.gW*sc/2} y={oy-1} textAnchor="middle" fontSize="6.5" fill="#4B5563">{mat.gW}×{mat.gH}(净{uw}×{uh})</text>
    </svg>
  );
}

/* ─── PDF 导出 ───────────────────────────────────────────────────── */
function exportToPDF(mats, pieces, results, qty) {
  const matById = Object.fromEntries(mats.map(m => [m.id, m]));
  const win = window.open("", "_blank");
  const now = new Date().toLocaleString("zh-CN");

  let rows = "";
  for (const [matId, r] of Object.entries(results)) {
    if (!r) continue;
    const mat = matById[matId];
    r.boards.forEach((b, bi) => {
      b.placed.forEach((p, pi) => {
        const grainMap = { with:"顺纹", against:"横纹", free:"任意" };
        rows += `<tr>
          <td>${mat.name}</td>
          <td>#${bi+1}</td>
          <td><span style="display:inline-block;width:10px;height:10px;background:${p.col};border-radius:2px;margin-right:4px;vertical-align:middle"></span>${p.name}</td>
          <td>${p.w}</td><td>${p.h}</td>
          <td style="color:${p.rotated?"#d97706":"#6b7280"}">${p.rotated?"旋转90°":"正常"}</td>
          <td>${grainMap[p.grain]||p.grain}</td>
          <td>${Math.round(p.x)}</td><td>${Math.round(p.y)}</td>
        </tr>`;
      });
    });
  }

  let summary = "";
  for (const [matId, r] of Object.entries(results)) {
    if (!r) continue;
    const mat = matById[matId];
    const uc = r.avgUsage>=88?"#059669":r.avgUsage>=70?"#d97706":"#dc2626";
    summary += `<tr>
      <td>${mat.name}</td>
      <td>${mat.gW}×${mat.gH}mm</td>
      <td>${mat.trim}mm</td>
      <td>${mat.kerf}mm</td>
      <td style="font-weight:700;color:${uc}">${r.avgUsage.toFixed(1)}%</td>
      <td>${r.n}</td>
      <td>RM ${r.cost.toFixed(2)}</td>
      <td style="color:${r.placed===r.needed?"#059669":"#dc2626"}">${r.placed}/${r.needed}</td>
    </tr>`;
  }

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>开料优化报告</title>
<style>
  body{font-family:'Microsoft YaHei',sans-serif;margin:30px;color:#111;font-size:12px}
  h1{font-size:20px;color:#1e3a5f;border-bottom:3px solid #F59E0B;padding-bottom:8px;margin-bottom:6px}
  .meta{color:#666;font-size:11px;margin-bottom:24px}
  h2{font-size:14px;color:#1e3a5f;margin:24px 0 8px;border-left:4px solid #F59E0B;padding-left:8px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px}
  th{background:#1e3a5f;color:white;padding:7px 8px;text-align:left;font-weight:600}
  td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
  tr:nth-child(even) td{background:#f9fafb}
  .footer{margin-top:30px;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px}
  @media print{body{margin:15px}}
</style></head>
<body>
  <h1>⊞ CutOptimizer — 开料优化报告</h1>
  <div class="meta">生成时间：${now} | 订单数量：${qty} 套 | 系统版本 v1.0</div>
  <h2>一、优化汇总</h2>
  <table>
    <thead><tr><th>板材名称</th><th>规格</th><th>修边</th><th>锯缝</th><th>平均利用率</th><th>用板数</th><th>总费用</th><th>已排/需排</th></tr></thead>
    <tbody>${summary}</tbody>
  </table>
  <h2>二、零件切割清单</h2>
  <table>
    <thead><tr><th>板材</th><th>板号</th><th>零件名称</th><th>切割宽(mm)</th><th>切割高(mm)</th><th>方向</th><th>纹路</th><th>X坐标</th><th>Y坐标</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">CutOptimizer 开料优化系统 — 本报告由系统自动生成，请核实后交锯床操作</div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

/* ─── CSV 导出 ───────────────────────────────────────────────────── */
function exportToCSV(mats, results) {
  const matById = Object.fromEntries(mats.map(m => [m.id, m]));
  const grainMap = { with:"顺纹", against:"横纹", free:"任意" };
  const lines = ["板材名称,板号,零件名称,切割宽mm,切割高mm,旋转,纹路,X坐标mm,Y坐标mm,利用率%"];
  for (const [matId, r] of Object.entries(results)) {
    if (!r) continue;
    const mat = matById[matId];
    const pct = r.avgUsage.toFixed(1);
    r.boards.forEach((b, bi) => {
      b.placed.forEach(p => {
        lines.push([
          mat.name, `#${bi+1}`, p.name, p.w, p.h,
          p.rotated ? "旋转90°" : "正常",
          grainMap[p.grain] || p.grain,
          Math.round(p.x), Math.round(p.y), pct
        ].join(","));
      });
    });
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `开料清单_${new Date().toLocaleDateString("zh-CN").replace(/\//g,"-")}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

/* ─── 工具函数 ───────────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);
const GRAIN_OPTS = [
  { v:"with",    l:"↕ 顺纹",    d:"零件高度方向与板材纹路一致（正常放置）" },
  { v:"against", l:"↔ 横纹",    d:"零件高度方向横跨板材纹路（强制旋转90°）" },
  { v:"free",    l:"↻ 任意",    d:"系统自动选择最优方向，不限制纹路" },
];

/* ─── 基础 UI 组件 ───────────────────────────────────────────────── */
const F = "system-ui,'Microsoft YaHei',sans-serif";
const FM = "'Courier New',monospace";
function Lbl({ c }) { return <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.07em", color:"#4B5563", textTransform:"uppercase", marginBottom:4 }}>{c}</div>; }
function Inp({ value, onChange, type="text", step, min, placeholder }) {
  return <input value={value} onChange={onChange} type={type} step={step} min={min} placeholder={placeholder}
    style={{ background:"#0d1117", border:"1px solid #1e2d3d", borderRadius:5, padding:"7px 9px", color:"#e2e8f0", fontSize:12, width:"100%", boxSizing:"border-box", fontFamily:FM, outline:"none" }} />;
}
function Sel({ value, onChange, children, style={} }) {
  return <select value={value} onChange={onChange}
    style={{ background:"#0d1117", border:"1px solid #1e2d3d", borderRadius:5, padding:"7px 9px", color:"#e2e8f0", fontSize:12, width:"100%", outline:"none", cursor:"pointer", fontFamily:F, ...style }}>
    {children}
  </select>;
}
function Bdg({ c="#94a3b8", children }) {
  return <span style={{ fontSize:9, fontWeight:700, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:3, padding:"1px 6px", color:c, letterSpacing:"0.04em", whiteSpace:"nowrap" }}>{children}</span>;
}
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, backdropFilter:"blur(4px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#0d1117", border:"1px solid #1e2d3d", borderRadius:12, width:480, maxWidth:"94vw", maxHeight:"88vh", overflowY:"auto", boxShadow:"0 32px 80px rgba(0,0,0,0.75)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 18px", borderBottom:"1px solid #1e2d3d" }}>
          <span style={{ fontWeight:700, fontSize:14, color:"#F1F5F9", fontFamily:F }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#4B5563", fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:"16px 18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   主程序
═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [mats,   setMats]   = useState(() => load("co_mats",   DEFAULT_MATS));
  const [pieces, setPieces] = useState(() => load("co_pieces", DEFAULT_PIECES));
  const [qty,    setQty]    = useState(() => load("co_qty",    20));
  const [results,setResults]= useState(null);
  const [view,   setView]   = useState("pieces");
  const [md,     setMd]     = useState(null);
  const [pd,     setPd]     = useState(null);
  const [mf,     setMf]     = useState({});
  const [pf,     setPf]     = useState({});
  const [fMat,   setFMat]   = useState("all");
  const si = useRef(0);
  const mById = Object.fromEntries(mats.map(m => [m.id, m]));

  // 自动保存
  useEffect(() => { save("co_mats",   mats);   }, [mats]);
  useEffect(() => { save("co_pieces", pieces); }, [pieces]);
  useEffect(() => { save("co_qty",    qty);    }, [qty]);

  /* ── 板材 CRUD ─────────────────────────────────────────────────── */
  const newMat   = () => { setMf({ name:"新板材", gW:1220, gH:2440, trim:5, kerf:4.6, price:20 }); setMd("new"); };
  const saveMat  = () => {
    const f = { ...mf, gW:+mf.gW, gH:+mf.gH, trim:+mf.trim, kerf:+mf.kerf, price:+mf.price };
    md==="new" ? setMats(ms=>[...ms,{...f,id:uid()}]) : setMats(ms=>ms.map(m=>m.id===md.id?{...f,id:m.id}:m));
    setMd(null);
  };
  const delMat = id => { if (!window.confirm("删除该板材？")) return; setMats(ms=>ms.filter(m=>m.id!==id)); };

  /* ── 零件 CRUD ─────────────────────────────────────────────────── */
  const newPiece  = () => { setPf({ name:"新零件", w:300, h:600, qty:1, grain:"with", matId:mats[0]?.id||"", col:SWATCHES[si.current++%SWATCHES.length] }); setPd("new"); };
  const savePiece = () => {
    const f = { ...pf, w:+pf.w, h:+pf.h, qty:+pf.qty };
    pd==="new" ? setPieces(ps=>[...ps,{...f,id:uid()}]) : setPieces(ps=>ps.map(p=>p.id===pd.id?{...f,id:p.id}:p));
    setPd(null);
  };
  const delPiece = id => setPieces(ps => ps.filter(p => p.id !== id));

  /* ── 优化 ──────────────────────────────────────────────────────── */
  const run = useCallback(() => {
    const r = runOptimize(mats, pieces, qty);
    setResults(r);
    setView("results");
  }, [mats, pieces, qty]);

  /* ── 重置数据 ──────────────────────────────────────────────────── */
  const resetData = () => {
    if (!window.confirm("重置为默认示例数据？现有数据将清除。")) return;
    setMats(DEFAULT_MATS); setPieces(DEFAULT_PIECES); setQty(20); setResults(null);
  };

  const vp = fMat==="all" ? pieces : pieces.filter(p=>p.matId===fMat);
  const totalCost = results ? Object.values(results).reduce((s,r)=>s+(r?.cost||0),0) : 0;

  /* ────────────────────────────────────────────────────────────────
     渲染
  ──────────────────────────────────────────────────────────────── */
  return (
    <div style={{ display:"flex", height:"100vh", background:"#080c12", fontFamily:F, color:"#94A3B8", overflow:"hidden" }}>

      {/* ══ 左侧导航栏 ══════════════════════════════════════════════ */}
      <aside style={{ width:256, background:"#0a0e16", borderRight:"1px solid #131c28", display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>

        {/* Logo */}
        <div style={{ padding:"16px 14px 12px", borderBottom:"1px solid #131c28" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="5" width="24" height="18" rx="2.5" fill="rgba(245,158,11,0.1)" stroke="#F59E0B" strokeWidth="1.5"/>
              <line x1="7"  y1="5" x2="7"  y2="23" stroke="#F59E0B" strokeWidth="1.4"/>
              <line x1="11.5" y1="5" x2="11.5" y2="23" stroke="#F59E0B" strokeWidth="0.6" strokeDasharray="2 1.5" opacity="0.4"/>
              <line x1="16" y1="5" x2="16" y2="23" stroke="#F59E0B" strokeWidth="0.6" strokeDasharray="2 1.5" opacity="0.4"/>
              <line x1="20" y1="5" x2="20" y2="23" stroke="#F59E0B" strokeWidth="1.4"/>
              <line x1="24" y1="5" x2="24" y2="23" stroke="#F59E0B" strokeWidth="1.4"/>
            </svg>
            <div>
              <div style={{ fontWeight:800, fontSize:15, color:"#F1F5F9", letterSpacing:"-0.02em" }}>CutOptimizer</div>
              <div style={{ fontSize:9, color:"#374151", letterSpacing:"0.1em" }}>开料优化系统 v1.0</div>
            </div>
          </div>
        </div>

        {/* 订单数量 */}
        <div style={{ padding:"12px 14px", borderBottom:"1px solid #131c28" }}>
          <Lbl c="订单数量（套）"/>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input type="number" min="1" value={qty} onChange={e=>setQty(Math.max(1,+e.target.value))}
              style={{ background:"#0d1117", border:"1px solid #1e2d3d", borderRadius:5, padding:"6px 8px", color:"#F59E0B", fontSize:20, fontWeight:800, width:64, textAlign:"center", fontFamily:FM, outline:"none" }}/>
            <span style={{ fontSize:11, color:"#374151" }}>套</span>
          </div>
        </div>

        {/* 板材列表 */}
        <div style={{ padding:"10px 14px", flex:1, overflowY:"auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <Lbl c="板材管理"/>
            <button onClick={newMat} style={{ fontSize:10, fontWeight:700, color:"#F59E0B", background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:4, padding:"2px 9px", cursor:"pointer" }}>+ 新增</button>
          </div>
          {mats.map(m => {
            const uw=m.gW-2*m.trim, uh=m.gH-2*m.trim;
            const r=results?.[m.id];
            const uc=r?.(r.avgUsage>=88?"#10B981":r.avgUsage>=70?"#F59E0B":"#EF4444"):undefined;
            return (
              <div key={m.id} style={{ background:"#0d1117", border:"1px solid #131c28", borderRadius:8, padding:"9px 10px", marginBottom:7 }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:6 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:11, color:"#CBD5E1", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</div>
                    <div style={{ fontSize:9, color:"#374151", marginTop:2, fontFamily:FM }}>{m.gW}×{m.gH} → 净{uw}×{uh}</div>
                    <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                      <Bdg c="#60A5FA">修边 {m.trim}mm</Bdg>
                      <Bdg c="#EF4444">锯缝 {m.kerf}mm</Bdg>
                      <Bdg c="#10B981">RM {m.price.toFixed(2)}</Bdg>
                    </div>
                    {r && <div style={{ display:"flex", gap:4, marginTop:4, flexWrap:"wrap" }}>
                      <Bdg c="#F59E0B">{r.n} 张</Bdg>
                      <Bdg c={uc||"#94A3B8"}>{r.avgUsage.toFixed(1)}% 利用率</Bdg>
                      <Bdg c="#E2E8F0">RM {r.cost.toFixed(2)}</Bdg>
                    </div>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
                    <button onClick={()=>{setMf({...m});setMd(m);}} style={{ background:"none", border:"none", color:"#4B5563", cursor:"pointer", fontSize:13, padding:"1px 3px" }} title="编辑">✎</button>
                    <button onClick={()=>delMat(m.id)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer", fontSize:11, padding:"1px 3px", opacity:0.7 }} title="删除">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
          {!mats.length && <div style={{ color:"#374151", fontSize:11, fontStyle:"italic" }}>暂无板材，请点击新增。</div>}
        </div>

        {/* 底部按钮区 */}
        <div style={{ padding:"10px 14px", borderTop:"1px solid #131c28", display:"flex", flexDirection:"column", gap:6 }}>
          <button onClick={run} style={{ width:"100%", padding:"11px 0", background:"linear-gradient(135deg,#d97706,#F59E0B)", color:"#0a0e16", border:"none", borderRadius:8, fontWeight:800, fontSize:13, cursor:"pointer", letterSpacing:"0.05em", boxShadow:"0 0 24px rgba(245,158,11,0.22)", fontFamily:F }}>
            ▶  立即优化
          </button>
          {results && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              <button onClick={()=>exportToPDF(mats,pieces,results,qty)}
                style={{ padding:"7px 0", background:"rgba(59,130,246,0.12)", color:"#60A5FA", border:"1px solid rgba(59,130,246,0.25)", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:F }}>
                🖨 打印报告
              </button>
              <button onClick={()=>exportToCSV(mats,results)}
                style={{ padding:"7px 0", background:"rgba(16,185,129,0.12)", color:"#34D399", border:"1px solid rgba(16,185,129,0.25)", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:F }}>
                ⬇ 导出 CSV
              </button>
            </div>
          )}
          <button onClick={resetData} style={{ padding:"5px 0", background:"transparent", color:"#374151", border:"1px solid #1a2030", borderRadius:6, fontSize:10, cursor:"pointer", fontFamily:F }}>
            ↺ 重置示例数据
          </button>
        </div>
      </aside>

      {/* ══ 主内容区 ═══════════════════════════════════════════════ */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Tab 栏 */}
        <div style={{ display:"flex", alignItems:"center", background:"#0a0e16", borderBottom:"1px solid #131c28", paddingLeft:20, height:46, gap:2, flexShrink:0 }}>
          {[["pieces","⊞  零件列表"],["results","⊟  排版结果"]].map(([id,lbl]) => (
            <button key={id} onClick={()=>setView(id)}
              style={{ background:"none", border:"none", borderBottom:view===id?"2px solid #F59E0B":"2px solid transparent", color:view===id?"#F59E0B":"#374151", fontSize:12, fontWeight:700, padding:"0 16px", height:"100%", cursor:"pointer", letterSpacing:"0.04em", fontFamily:F, transition:"color 0.15s" }}>
              {lbl}
            </button>
          ))}
          {results && (
            <div style={{ marginLeft:12, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:10, color:"#374151" }}>总费用:</span>
              <span style={{ fontSize:13, fontWeight:800, color:"#F59E0B", fontFamily:FM }}>RM {totalCost.toFixed(2)}</span>
            </div>
          )}
          <div style={{ flex:1 }}/>
          {view==="pieces" && (
            <div style={{ display:"flex", gap:8, alignItems:"center", paddingRight:16 }}>
              <Sel value={fMat} onChange={e=>setFMat(e.target.value)} style={{ width:160, fontSize:11 }}>
                <option value="all">全部板材</option>
                {mats.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Sel>
              <button onClick={newPiece} style={{ background:"#F59E0B", color:"#0a0e16", border:"none", borderRadius:6, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:F }}>+ 新增零件</button>
            </div>
          )}
        </div>

        {/* ── 零件列表 ─────────────────────────────────────────── */}
        {view==="pieces" && (
          <div style={{ flex:1, overflowY:"auto", padding:"0 20px 24px" }}>
            {vp.length===0 ? (
              <div style={{ textAlign:"center", padding:"70px 0", color:"#374151" }}>
                <div style={{ fontSize:40, marginBottom:14 }}>⊞</div>
                <div style={{ fontSize:14, marginBottom:18 }}>暂无零件。</div>
                <button onClick={newPiece} style={{ background:"#F59E0B", color:"#0a0e16", border:"none", borderRadius:6, padding:"9px 24px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F }}>+ 新增第一个零件</button>
              </div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, marginTop:10 }}>
                <thead>
                  <tr>{["","零件名称","宽W(mm)","高H(mm)","数量/套",`合计×${qty}套`,"纹路方向","板材","面积mm²",""].map((h,i)=>(
                    <th key={i} style={{ textAlign:i===0||i===9?"center":"left", padding:"8px 10px", fontSize:9, fontWeight:700, color:"#374151", letterSpacing:"0.06em", borderBottom:"1px solid #131c28", textTransform:"uppercase", background:"#0a0e16", whiteSpace:"nowrap" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {vp.map((p,i) => {
                    const mat=mById[p.matId];
                    const gc=p.grain==="with"?"#60A5FA":p.grain==="against"?"#F97316":"#64748B";
                    const gl=p.grain==="with"?"↕ 顺纹":p.grain==="against"?"↔ 横纹":"↻ 任意";
                    return (
                      <tr key={p.id} style={{ background:i%2===0?"transparent":"rgba(13,17,23,0.5)" }}>
                        <td style={{ padding:"8px 10px", textAlign:"center" }}><div style={{ width:10, height:10, borderRadius:3, background:p.col, margin:"0 auto" }}/></td>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:"#CBD5E1" }}>{p.name}</td>
                        <td style={{ padding:"8px 10px", color:"#94A3B8", textAlign:"right", fontFamily:FM }}>{p.w}</td>
                        <td style={{ padding:"8px 10px", color:"#94A3B8", textAlign:"right", fontFamily:FM }}>{p.h}</td>
                        <td style={{ padding:"8px 10px", color:"#94A3B8", textAlign:"right", fontFamily:FM }}>{p.qty}</td>
                        <td style={{ padding:"8px 10px", color:"#F59E0B", fontWeight:700, textAlign:"right", fontFamily:FM }}>{p.qty*qty}</td>
                        <td style={{ padding:"8px 10px" }}><span style={{ fontSize:10, fontWeight:700, color:gc, background:"rgba(255,255,255,0.04)", padding:"2px 6px", borderRadius:3 }}>{gl}</span></td>
                        <td style={{ padding:"8px 10px", color:"#4B5563", maxWidth:130, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {mat ? mat.name : <span style={{ color:"#EF4444", fontStyle:"italic" }}>未分配</span>}
                        </td>
                        <td style={{ padding:"8px 10px", color:"#374151", textAlign:"right", fontFamily:FM }}>{(p.w*p.h).toLocaleString()}</td>
                        <td style={{ padding:"8px 10px", textAlign:"center" }}>
                          <div style={{ display:"flex", gap:4, justifyContent:"center" }}>
                            <button onClick={()=>{setPf({...p});setPd(p);}} style={{ background:"none", border:"none", color:"#4B5563", cursor:"pointer", fontSize:13 }} title="编辑">✎</button>
                            <button onClick={()=>delPiece(p.id)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer", fontSize:11, opacity:0.7 }} title="删除">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── 排版结果 ─────────────────────────────────────────── */}
        {view==="results" && (
          <div style={{ flex:1, overflowY:"auto", padding:"0 20px 24px" }}>
            {!results ? (
              <div style={{ textAlign:"center", padding:"80px 0", color:"#374151" }}>
                <div style={{ fontSize:36, marginBottom:14, opacity:0.4 }}>⊟</div>
                <div style={{ fontSize:14, marginBottom:20 }}>点击左侧 <b style={{ color:"#F59E0B" }}>立即优化</b> 生成排版方案。</div>
              </div>
            ) : (
              <>
                {/* 汇总卡片 */}
                <div style={{ display:"flex", gap:10, padding:"14px 0 4px", flexWrap:"wrap" }}>
                  {mats.map(mat => {
                    const r=results[mat.id]; if(!r) return null;
                    const uc=r.avgUsage>=88?"#10B981":r.avgUsage>=70?"#F59E0B":"#EF4444";
                    return (
                      <div key={mat.id} style={{ background:"#0d1117", border:"1px solid #131c28", borderRadius:9, padding:"12px 16px", flex:"1 1 180px" }}>
                        <div style={{ fontSize:10, color:"#374151", marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{mat.name}</div>
                        <div style={{ fontSize:28, fontWeight:800, color:uc, lineHeight:1, fontFamily:FM }}>{r.avgUsage.toFixed(1)}<span style={{ fontSize:13, fontWeight:400, color:"#4B5563" }}>%</span></div>
                        <div style={{ fontSize:9, color:"#374151", margin:"4px 0 7px" }}>平均板材利用率</div>
                        <div style={{ height:3, background:"#131c28", borderRadius:2, overflow:"hidden", marginBottom:8 }}>
                          <div style={{ height:"100%", width:`${Math.min(r.avgUsage,100)}%`, background:uc, borderRadius:2 }}/>
                        </div>
                        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                          <Bdg c="#F59E0B">用 {r.n} 张板</Bdg>
                          <Bdg c="#10B981">RM {r.cost.toFixed(2)}</Bdg>
                          <Bdg c={r.placed===r.needed?"#10B981":"#EF4444"}>{r.placed}/{r.needed} 件</Bdg>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ background:"#0d1117", border:"1px solid #F59E0B33", borderRadius:9, padding:"12px 16px", flex:"0 0 auto", display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center" }}>
                    <div style={{ fontSize:9, color:"#374151", marginBottom:4 }}>总材料费用</div>
                    <div style={{ fontSize:26, fontWeight:800, color:"#F59E0B", fontFamily:FM }}>RM {totalCost.toFixed(2)}</div>
                    <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>{qty} 套订单</div>
                  </div>
                </div>

                {/* 各板材排版图 */}
                {mats.map(mat => {
                  const r=results[mat.id]; if(!r||!r.boards.length) return null;
                  const avgU=r.avgUsage;
                  return (
                    <div key={mat.id} style={{ marginTop:22 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", borderBottom:"1px solid #131c28", paddingBottom:7, marginBottom:12 }}>
                        <span style={{ fontWeight:700, fontSize:13, color:"#E2E8F0" }}>{mat.name}</span>
                        <span style={{ fontSize:10, color:"#374151", fontFamily:FM }}>
                          {mat.gW}×{mat.gH}mm · 修边{mat.trim}mm · 锯缝{mat.kerf}mm · 共{r.n}张 · RM {r.cost.toFixed(2)}
                        </span>
                      </div>

                      {/* 排版图阵列 */}
                      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:14 }}>
                        {r.boards.map((b,bi) => (
                          <div key={bi} style={{ background:"#0d1117", border:"1px solid #131c28", borderRadius:8, padding:8, display:"inline-block" }}>
                            <BoardDiagram board={b} mat={mat} uw={r.uw} uh={r.uh} idx={bi} total={r.n}/>
                          </div>
                        ))}
                      </div>

                      {/* 切割清单折叠 */}
                      <details style={{ marginBottom:10 }}>
                        <summary style={{ cursor:"pointer", color:"#4B5563", fontSize:11, paddingBottom:6, userSelect:"none" }}>
                          ▸ 切割清单 — 共 {r.boards.reduce((s,b)=>s+b.placed.length,0)} 件，分布在 {r.n} 张板上
                        </summary>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginTop:6 }}>
                          <thead><tr>{["板号","零件名称","切割宽mm","切割高mm","是否旋转","纹路","X坐标","Y坐标"].map((h,i)=>(
                            <th key={i} style={{ textAlign:i<=1?"left":"right", padding:"6px 8px", fontSize:9, fontWeight:700, color:"#374151", letterSpacing:"0.06em", borderBottom:"1px solid #131c28", textTransform:"uppercase", background:"#0a0e16" }}>{h}</th>
                          ))}</tr></thead>
                          <tbody>
                            {r.boards.flatMap((b,bi)=>b.placed.map((p,pi)=>{
                              const gc=p.grain==="with"?"#60A5FA":p.grain==="against"?"#F97316":"#4B5563";
                              const gl=p.grain==="with"?"↕顺纹":p.grain==="against"?"↔横纹":"↻任意";
                              return (
                                <tr key={`${bi}-${pi}`} style={{ background:(bi+pi)%2===0?"transparent":"rgba(13,17,23,0.5)" }}>
                                  <td style={{ padding:"6px 8px", color:"#4B5563" }}>#{bi+1}</td>
                                  <td style={{ padding:"6px 8px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                      <div style={{ width:7, height:7, borderRadius:2, background:p.col, flexShrink:0 }}/>
                                      <span style={{ color:"#CBD5E1", fontWeight:600 }}>{p.name}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"6px 8px", textAlign:"right", color:"#94A3B8", fontFamily:FM }}>{p.w}</td>
                                  <td style={{ padding:"6px 8px", textAlign:"right", color:"#94A3B8", fontFamily:FM }}>{p.h}</td>
                                  <td style={{ padding:"6px 8px", textAlign:"right" }}>
                                    <span style={{ color:p.rotated?"#F59E0B":"#374151", fontWeight:p.rotated?700:400 }}>{p.rotated?"旋转90°":"–"}</span>
                                  </td>
                                  <td style={{ padding:"6px 8px", textAlign:"right" }}>
                                    <span style={{ fontSize:10, color:gc, fontWeight:700 }}>{gl}</span>
                                  </td>
                                  <td style={{ padding:"6px 8px", textAlign:"right", color:"#374151", fontFamily:FM }}>{Math.round(p.x)}</td>
                                  <td style={{ padding:"6px 8px", textAlign:"right", color:"#374151", fontFamily:FM }}>{Math.round(p.y)}</td>
                                </tr>
                              );
                            }))}
                          </tbody>
                        </table>
                      </details>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* ══ 板材弹窗 ═══════════════════════════════════════════════ */}
      {md && (
        <Modal title={md==="new"?"新增板材":"编辑板材"} onClose={()=>setMd(null)}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:10, marginBottom:10 }}>
            <div><Lbl c="板材名称"/><Inp value={mf.name||""} onChange={e=>setMf({...mf,name:e.target.value})}/></div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div><Lbl c="板材宽度 (mm)"/><Inp type="number" min="1" value={mf.gW||""} onChange={e=>setMf({...mf,gW:e.target.value})}/></div>
              <div><Lbl c="板材高度 (mm)"/><Inp type="number" min="1" value={mf.gH||""} onChange={e=>setMf({...mf,gH:e.target.value})}/></div>
              <div><Lbl c="修边量 — 四边 (mm)"/><Inp type="number" min="0" step="0.5" value={mf.trim||""} onChange={e=>setMf({...mf,trim:e.target.value})}/></div>
              <div><Lbl c="锯片厚度/锯缝 (mm)"/><Inp type="number" min="0" step="0.1" value={mf.kerf||""} onChange={e=>setMf({...mf,kerf:e.target.value})}/></div>
              <div><Lbl c="每张板价格 (RM)"/><Inp type="number" min="0" step="0.01" value={mf.price||""} onChange={e=>setMf({...mf,price:e.target.value})}/></div>
            </div>
          </div>
          {mf.gW && mf.gH && mf.trim !== undefined && (
            <div style={{ background:"#060912", border:"1px solid #1e2d3d", borderRadius:6, padding:"8px 12px", fontSize:11, color:"#4B5563", marginBottom:12 }}>
              修边后净尺寸：<b style={{ color:"#F59E0B", fontFamily:FM }}>{+mf.gW-2*+mf.trim} × {+mf.gH-2*+mf.trim} mm</b>
              <span style={{ marginLeft:8, color:"#374151" }}>（{((+mf.gW-2*+mf.trim)*(+mf.gH-2*+mf.trim)/1e6).toFixed(4)} m²）</span>
            </div>
          )}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={()=>setMd(null)} style={{ background:"transparent", color:"#64748B", border:"1px solid #1e2d3d", borderRadius:6, padding:"7px 16px", fontSize:12, cursor:"pointer", fontFamily:F }}>取消</button>
            <button onClick={saveMat} style={{ background:"#F59E0B", color:"#0a0e16", border:"none", borderRadius:6, padding:"7px 20px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:F }}>保存</button>
          </div>
        </Modal>
      )}

      {/* ══ 零件弹窗 ═══════════════════════════════════════════════ */}
      {pd && (
        <Modal title={pd==="new"?"新增零件":"编辑零件"} onClose={()=>setPd(null)}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <div style={{ gridColumn:"1/-1" }}><Lbl c="零件名称"/><Inp value={pf.name||""} onChange={e=>setPf({...pf,name:e.target.value})}/></div>
            <div><Lbl c="宽度 W (mm)"/><Inp type="number" min="1" value={pf.w||""} onChange={e=>setPf({...pf,w:e.target.value})}/></div>
            <div><Lbl c="高度 H (mm)"/><Inp type="number" min="1" value={pf.h||""} onChange={e=>setPf({...pf,h:e.target.value})}/></div>
            <div><Lbl c="数量 / 套"/><Inp type="number" min="1" value={pf.qty||""} onChange={e=>setPf({...pf,qty:e.target.value})}/></div>
          </div>

          <div style={{ marginBottom:10 }}>
            <Lbl c="木纹方向"/>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {GRAIN_OPTS.map(({ v, l, d }) => (
                <label key={v} style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", background:pf.grain===v?"rgba(245,158,11,0.08)":"#0d1117", border:`1px solid ${pf.grain===v?"rgba(245,158,11,0.35)":"#1e2d3d"}`, borderRadius:7, padding:"9px 12px", transition:"all 0.15s" }}>
                  <input type="radio" name="grain" value={v} checked={pf.grain===v} onChange={()=>setPf({...pf,grain:v})} style={{ marginTop:2, accentColor:"#F59E0B", flexShrink:0 }}/>
                  <div>
                    <div style={{ fontWeight:700, fontSize:12, color:pf.grain===v?"#F59E0B":"#94A3B8" }}>{l}</div>
                    <div style={{ fontSize:10, color:"#4B5563", marginTop:1 }}>{d}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ fontSize:10, color:"#374151", marginTop:6, background:"#060912", padding:"7px 10px", borderRadius:5 }}>
              💡 建议将 H 设为零件<em>沿纹方向</em>的尺寸。如侧板：W=480、H=1800，纹路选"顺纹"。
            </div>
          </div>

          <div style={{ marginBottom:10 }}>
            <Lbl c="板材类型"/>
            <Sel value={pf.matId||""} onChange={e=>setPf({...pf,matId:e.target.value})}>
              <option value="">— 未分配 —</option>
              {mats.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Sel>
          </div>

          <div style={{ marginBottom:14 }}>
            <Lbl c="显示颜色"/>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {SWATCHES.map(c => (
                <button key={c} onClick={()=>setPf({...pf,col:c})} style={{ width:22, height:22, borderRadius:4, background:c, border:pf.col===c?"2px solid white":"2px solid transparent", cursor:"pointer", padding:0, transition:"border 0.1s" }}/>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button onClick={()=>setPd(null)} style={{ background:"transparent", color:"#64748B", border:"1px solid #1e2d3d", borderRadius:6, padding:"7px 16px", fontSize:12, cursor:"pointer", fontFamily:F }}>取消</button>
            <button onClick={savePiece} style={{ background:"#F59E0B", color:"#0a0e16", border:"none", borderRadius:6, padding:"7px 20px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:F }}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
