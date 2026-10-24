// Sample data for trying DampLog, dated relative to today. The photos are drawn
// on a canvas so the sample needs no real images of anyone's home.

import { addDays, addWorkingDays, cleanEntry, cleanIssue, isWorkingDay } from './core.js';

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

function spots(ctx, r, centres, count, palette) {
  const point = () => {
    const c = centres[Math.floor(r() * centres.length)];
    return [c.x + gauss(r) * c.sx, c.y + gauss(r) * c.sy];
  };
  // Soft staining under the growth, then fine speckles on top.
  ctx.save();
  ctx.filter = 'blur(9px)';
  for (let i = 0; i < count / 10; i++) {
    const [x, y] = point();
    ctx.fillStyle = `rgba(70,66,48,${(0.04 + r() * 0.12).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, 8 + r() * 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < count * 1.6; i++) {
    const [x, y] = point();
    const size = 0.5 + r() ** 4 * 4.5;
    ctx.fillStyle = palette[Math.floor(r() * palette.length)].replace('A', (0.3 + r() * 0.55).toFixed(2));
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * (0.7 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function wall(ctx, w, h, r) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#e6e1d7');
  g.addColorStop(1, '#d6cfc2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,80,60'},0.035)`;
    ctx.fillRect(r() * w, r() * h, 2, 2);
  }
}

function vignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const MOULD = ['rgba(28,30,24,A)', 'rgba(44,48,34,A)', 'rgba(62,58,40,A)', 'rgba(20,20,20,A)'];

/** Draws one sample photo: 'corner', 'window', 'wardrobe' or 'sink'. */
export function drawSample(kind, seed = 1) {
  const w = 1200;
  const h = 900;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const r = rng(seed);

  if (kind === 'sink') {
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e9e5de';
    ctx.fillRect(60, 40, w - 120, h - 80);
    ctx.fillStyle = '#cfc9bf';
    ctx.fillRect(60, h - 220, w - 120, 180);
    ctx.strokeStyle = '#9aa1a8';
    ctx.lineWidth = 34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(620, 40);
    ctx.lineTo(620, 330);
    ctx.quadraticCurveTo(620, 420, 520, 420);
    ctx.lineTo(380, 420);
    ctx.lineTo(380, 560);
    ctx.stroke();
    const stain = ctx.createRadialGradient(560, h - 150, 20, 560, h - 150, 330);
    stain.addColorStop(0, 'rgba(92,64,34,0.75)');
    stain.addColorStop(0.6, 'rgba(120,86,48,0.35)');
    stain.addColorStop(1, 'rgba(120,86,48,0)');
    ctx.fillStyle = stain;
    ctx.fillRect(60, h - 520, w - 120, 480);
    spots(ctx, r, [{ x: 560, y: h - 120, sx: 170, sy: 50 }], 1600, MOULD);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(612 + r() * 16, 120 + i * 40, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    vignette(ctx, w, h);
    return canvas;
  }

  wall(ctx, w, h, r);
  if (kind === 'wardrobe') {
    ctx.fillStyle = '#efece6';
    ctx.fillRect(0, h - 70, w, 70);
    ctx.fillStyle = '#6b4f37';
    ctx.fillRect(w - 380, 0, 380, h - 60);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(w - 410, 0, 30, h - 60);
    spots(ctx, r, [{ x: 640, y: h - 120, sx: 170, sy: 70 }, { x: 790, y: h - 260, sx: 40, sy: 160 }, { x: 420, y: h - 90, sx: 120, sy: 25 }], 5200, MOULD);
  } else {
    // A ceiling line and the corner of the room.
    ctx.fillStyle = '#efebe4';
    ctx.fillRect(0, 0, w, 150);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 150, w, 6);
    const corner = ctx.createLinearGradient(860, 0, w, 0);
    corner.addColorStop(0, 'rgba(0,0,0,0.16)');
    corner.addColorStop(1, 'rgba(0,0,0,0.04)');
    ctx.fillStyle = corner;
    ctx.fillRect(860, 156, w - 860, h);
    if (kind === 'window') {
      ctx.fillStyle = '#f6f5f2';
      ctx.fillRect(140, 300, 460, 520);
      const glass = ctx.createLinearGradient(170, 330, 570, 790);
      glass.addColorStop(0, '#a9bccb');
      glass.addColorStop(1, '#7f93a3');
      ctx.fillStyle = glass;
      ctx.fillRect(172, 332, 396, 456);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 260; i++) ctx.fillRect(172 + r() * 396, 332 + r() * 456, 3, 3 + r() * 9);
      spots(ctx, r, [{ x: 370, y: 296, sx: 160, sy: 12 }, { x: 150, y: 560, sx: 10, sy: 150 }, { x: 590, y: 560, sx: 10, sy: 150 }], 2600, MOULD);
    }
    spots(ctx, r, [{ x: 870, y: 175, sx: 120, sy: 55 }, { x: 980, y: 210, sx: 80, sy: 90 }, { x: 700, y: 165, sx: 90, sy: 18 }], kind === 'window' ? 3200 : 6500, MOULD);
  }
  vignette(ctx, w, h);
  return canvas;
}

const at = (date, time) => `${date}T${time}`;

/** Moves a date back to the nearest working day, so sample reports fall on weekdays. */
function weekday(date) {
  let d = date;
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
}

/**
 * @param {string} today 'YYYY-MM-DD'
 * @param {{ now: string, newId: () => string }} ctx
 * @returns {{ home, issues, entries, photoPlan: Array<{ id, issueId, kind, seed, takenAt }> }}
 */
export function sampleData(today, ctx) {
  const home = {
    tenantName: 'Sam Carter',
    address: 'Flat 14, Elm Court, London',
    landlordName: 'Elm Court Housing Association',
    landlordEmail: 'repairs@example.org',
    landlordType: 'social',
    tenancyRef: 'EC-00714',
    household: 'Me, my partner and our son (4), who has asthma.',
  };

  const mould = cleanIssue({
    kind: 'damp-mould', room: 'Bedroom', title: 'Black mould in the bedroom', firstNoticed: addDays(today, -41),
    description: 'Black mould in the top corner of the bedroom above the window, spreading along the ceiling. The window frame is wet every morning and the wall feels cold and damp.',
  }, ctx);
  const leak = cleanIssue({
    kind: 'leak', room: 'Kitchen', title: 'Leak under the kitchen sink', firstNoticed: addDays(today, -84),
    description: 'Water dripping from the waste pipe under the sink. The cupboard base is swollen and stained.',
  }, ctx);

  const photoPlan = [];
  const photo = (issue, kind, seed, takenAt) => {
    const id = ctx.newId();
    photoPlan.push({ id, issueId: issue.id, kind, seed, takenAt });
    return id;
  };

  const reported = weekday(addDays(today, -21));
  const leakReported = weekday(addDays(today, -80));
  const leakInvestigated = addWorkingDays(leakReported, 3);
  const entries = [
    { issueId: mould.id, type: 'observation', at: at(addDays(today, -40), '19:20'),
      text: 'Black spots in the corner above the window, about the size of a dinner plate. Condensation running down the glass.',
      photoIds: [photo(mould, 'corner', 7, at(addDays(today, -40), '19:18')), photo(mould, 'window', 11, at(addDays(today, -40), '19:19'))] },
    { issueId: mould.id, type: 'reported', at: at(reported, '10:05'), method: 'Phone', reference: 'EC-48213',
      text: 'Called the repairs line. Told them about the mould and that our son has asthma. They said a surveyor would call to book a visit.' },
    { issueId: mould.id, type: 'health', at: at(addDays(today, -12), '08:10'),
      text: 'Our son has needed his blue inhaler most nights this week. The GP said damp and mould can make asthma worse.' },
    { issueId: mould.id, type: 'contact', at: at(weekday(addDays(today, -6)), '13:40'), method: 'Email',
      text: 'Emailed repairs to ask when the surveyor will visit. No reply yet.' },
    { issueId: mould.id, type: 'observation', at: at(addDays(today, -2), '18:55'),
      text: 'Mould has spread behind the wardrobe and along the skirting board.',
      photoIds: [photo(mould, 'wardrobe', 23, at(addDays(today, -2), '18:52'))] },

    { issueId: leak.id, type: 'observation', at: at(addDays(today, -84), '20:30'), text: 'Water pooling in the cupboard under the sink.',
      photoIds: [photo(leak, 'sink', 5, at(addDays(today, -84), '20:28'))] },
    { issueId: leak.id, type: 'reported', at: at(leakReported, '09:15'), method: 'Online portal or app', reference: 'EC-47002', text: 'Reported through the online repairs form.' },
    { issueId: leak.id, type: 'investigation', at: at(leakInvestigated, '11:00'), text: 'Plumber visited and found a cracked waste pipe.' },
    { issueId: leak.id, type: 'summary', at: at(addWorkingDays(leakInvestigated, 1), '16:20'), outcome: 'hazard', text: 'Email: waste pipe to be replaced and cupboard base renewed.' },
    { issueId: leak.id, type: 'made-safe', at: at(addWorkingDays(leakInvestigated, 2), '10:30'), text: 'Pipe replaced. Leak stopped.' },
    { issueId: leak.id, type: 'works', at: at(addWorkingDays(leakInvestigated, 6), '09:00'), text: 'Carpenter replaced the cupboard base.' },
    { issueId: leak.id, type: 'fixed', at: at(addWorkingDays(leakInvestigated, 6), '15:00'), text: 'All work finished.' },
  ].map((e) => cleanEntry(e, ctx));

  leak.closedAt = addWorkingDays(leakInvestigated, 6);
  return { home, issues: [mould, leak], entries, photoPlan };
}
