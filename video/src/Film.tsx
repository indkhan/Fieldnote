import { loadFont } from "@remotion/fonts";
import { Audio } from "@remotion/media";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import energy from "./energy.json";
import paths from "./paths.json";

loadFont({ family: "Inter", url: staticFile("inter.woff2"), weight: "100 900" });

const B = 30; // 120 BPM at 60 fps: every beat is exactly 30 frames, so all cuts land on the music.
const CANVAS = "#010102";
const INK = "#f7f8f8";
const SOFT = "#d0d6e0";
const MUTED = "#8a8f98";
const LAVENDER = "#5e6ad2";
const LIGHT_LAVENDER = "#a5adff";
const SURFACE = "#0f1011";
const SURFACE_2 = "#16171a";
const LINE = "#2a2c33";
const VOICE = "#79bd90";
const RED = "#ef5b5b";
const SANS = "Inter, sans-serif";
const MONO = "Consolas, 'SF Mono', Menlo, monospace";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const center: CSSProperties = { alignItems: "center", justifyContent: "center" };

const useShape = () => {
  const { width, height } = useVideoConfig();
  const square = width === height;
  return { width, height, square, panel: Math.min(width * 0.86, 1480), fit: (px: number) => px * (square ? 0.68 : 1) };
};

const Slam = ({ children, size, at = 0, color = INK, weight = 650, from = 1.45, style }: { children: ReactNode; size: number; at?: number; color?: string; weight?: number; from?: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const t = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 340, mass: 0.7 } });
  return (
    <div style={{ fontFamily: SANS, fontSize: size, fontWeight: weight, color, lineHeight: 1.04, letterSpacing: "-0.045em", textAlign: "center", transform: `scale(${interpolate(t, [0, 1], [from, 1])})`, opacity: interpolate(frame - at, [-1, 2], [0, 1], clamp), ...style }}>
      {children}
    </div>
  );
};

const Rise = ({ children, at = 0, distance = 70, style }: { children: ReactNode; at?: number; distance?: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const t = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 240, mass: 0.7 } });
  return <div style={{ transform: `translateY(${(1 - t) * distance}px) scale(${0.96 + 0.04 * t})`, opacity: Math.min(1, (frame - at + 1) / 4), ...style }}>{children}</div>;
};

const Zoom = ({ children, to = 1.06, frames }: { children: ReactNode; to?: number; frames: number }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ ...center, transform: `scale(${interpolate(frame, [0, frames], [1, to], clamp)})` }}>{children}</AbsoluteFill>;
};

const Scene = ({ from, to, background = CANVAS, children }: { from: number; to: number; background?: string; children: ReactNode }) => (
  <Sequence from={from * B} durationInFrames={(to - from) * B}>
    <AbsoluteFill style={{ background, ...center }}>{children}</AbsoluteFill>
  </Sequence>
);

const Logo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ flexShrink: 0 }}>
    <defs>
      <linearGradient id="film-logo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7782ee" />
        <stop offset="1" stopColor="#454fb6" />
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" rx="224" fill="url(#film-logo)" />
    <path fill="#fff" d="M336 176H612L776 340V784a64 64 0 0 1-64 64H336a64 64 0 0 1-64-64V240a64 64 0 0 1 64-64Z" />
    <path fill="#c7ccfa" d="M612 176 776 340H660a48 48 0 0 1-48-48Z" />
    <g fill="#4d58cc">
      {[[334, 522, 124], [412, 462, 244], [490, 396, 376], [568, 462, 244], [646, 522, 124]].map(([x, y, h]) => (
        <rect key={x} x={x} y={y} width="52" height={h} rx="26" />
      ))}
    </g>
  </svg>
);

const Claude = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d97757" d={paths.claude} /></svg>
);
const Codex = ({ size, color = INK }: { size: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill={color} fillRule="evenodd" clipRule="evenodd" d={paths.codex} /></svg>
);

type Key = [frame: number, scale: number, x: number, y: number];

const Punch = ({ keys, children }: { keys: Key[]; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const { panel } = useShape();
  let index = 0;
  keys.forEach((key, i) => {
    if (frame >= key[0]) index = i;
  });
  const current = keys[index];
  const previous = keys[Math.max(0, index - 1)];
  const t = Easing.out(Easing.cubic)(Math.min(1, (frame - current[0]) / 6));
  const drift = 1 + (frame - current[0]) * 0.00035;
  const mix = (a: number, b: number) => a + (b - a) * t;
  const unit = panel / 1480;
  return (
    <AbsoluteFill style={{ ...center, transform: `translate(${mix(previous[2], current[2]) * unit}px, ${mix(previous[3], current[3]) * unit}px) scale(${mix(previous[1], current[1]) * drift})` }}>
      {children}
    </AbsoluteFill>
  );
};

const Word = ({ text, color }: { text: string; color: string }) => {
  const { width } = useShape();
  const size = Math.min(250, (width * 0.88) / (text.length * 0.5));
  return <Zoom frames={30} to={1.06}><Slam size={size} color={color} from={1.35} style={{ whiteSpace: "nowrap" }}>{text}</Slam></Zoom>;
};

// ---- The problem
const people = [["AR", "Alex"], ["PS", "Priya"], ["JL", "Jordan"], ["SO", "Sam"], ["MC", "Maya"]];

const FiveCustomers = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { fit, square } = useShape();
  return (
    <Zoom frames={120} to={1.07}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: SANS, fontSize: fit(112), color: SOFT, fontWeight: 550, letterSpacing: "-0.035em" }}>You just talked to</div>
        <Slam at={B} size={fit(206)} style={{ marginTop: 10 }}>5 customers.</Slam>
        <div style={{ display: "flex", gap: square ? 22 : 34, marginTop: 66, minHeight: 170 }}>
          {people.map(([initials, name], i) => {
            const at = B * 1.5 + i * 15;
            if (frame < at) return <div key={name} style={{ width: 118 }} />;
            const t = spring({ frame: frame - at, fps, config: { damping: 10, stiffness: 300, mass: 0.6 } });
            return (
              <div key={name} style={{ width: 118, textAlign: "center", transform: `scale(${t})` }}>
                <div style={{ width: 118, height: 118, borderRadius: "50%", display: "grid", placeItems: "center", background: LAVENDER, color: "#fff", fontFamily: SANS, fontWeight: 600, fontSize: 38 }}>{initials}</div>
                <div style={{ marginTop: 13, fontFamily: SANS, fontSize: 28, color: SOFT }}>{name}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Zoom>
  );
};

const scraps = [
  { text: "voice memo 14.m4a", kind: "file", x: -0.34, y: -0.33, r: -7 },
  { text: "notes_final_v2.docx", kind: "doc", x: 0.31, y: -0.3, r: 5 },
  { text: "ask about pricing??", kind: "sticky", x: -0.3, y: 0.27, r: 6 },
  { text: "Zoom recording (3)", kind: "file", x: 0.33, y: 0.26, r: -6 },
  { text: "what did Priya say?", kind: "chat", x: -0.03, y: -0.38, r: -3 },
  { text: "IMG_2041.png", kind: "doc", x: 0.03, y: 0.37, r: 4 },
  { text: "call thursday.txt", kind: "sticky", x: -0.37, y: -0.15, r: 9 },
  { text: "she mentioned something", kind: "chat", x: 0.34, y: 0.15, r: -8 },
] as const;

const Scraps = ({ falling = false }: { falling?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height, square } = useShape();
  const scale = square ? 0.78 : 1;
  return (
    <AbsoluteFill style={center}>
      {scraps.map((scrap, i) => {
        const at = falling ? -1 : 15 + i * 15;
        if (frame < at) return null;
        const landed = falling ? 1 : spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 340, mass: 0.6 } });
        const drop = falling ? 0.05 * (frame + 3) ** 2 * (0.7 + random(`fall-${i}`) * 0.7) : 0;
        const look: CSSProperties =
          scrap.kind === "sticky" ? { background: "#f4d35e", color: "#2b2300", fontFamily: "'Segoe Print', 'Comic Sans MS', cursive" }
          : scrap.kind === "doc" ? { background: "#f4f5f7", color: "#22252b" }
          : scrap.kind === "chat" ? { background: "#2b6cf0", color: "#fff", borderRadius: 34 }
          : { background: "#22242a", color: INK, border: `2px solid ${LINE}` };
        return (
          <div key={scrap.text} style={{ position: "absolute", transform: `translate(${scrap.x * width}px, ${scrap.y * height + drop}px) rotate(${scrap.r + (falling ? frame * (i % 2 ? 0.5 : -0.5) : 0)}deg) scale(${interpolate(landed, [0, 1], [1.8, 1]) * scale})`, opacity: falling ? interpolate(frame, [0, 70], [0.9, 0], clamp) : Math.min(1, landed * 2), padding: "20px 28px", borderRadius: 12, fontFamily: SANS, fontSize: 44, fontWeight: 550, whiteSpace: "nowrap", boxShadow: "0 18px 60px #000a", filter: falling ? "grayscale(1)" : "none", ...look }}>
            {scrap.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Chaos = () => {
  const frame = useCurrentFrame();
  const { fit, square } = useShape();
  const shake = interpolate(frame, [20, 120], [0, 7], clamp);
  return (
    <AbsoluteFill style={{ ...center, transform: `translate(${(random(`x${frame}`) - 0.5) * shake}px, ${(random(`y${frame}`) - 0.5) * shake}px)` }}>
      <Slam size={fit(124)} style={{ maxWidth: square ? 720 : 1560, position: "relative" }}>So where did it all go?</Slam>
      <Scraps />
    </AbsoluteFill>
  );
};

const WeekLater = () => {
  const { fit } = useShape();
  return (
    <AbsoluteFill style={center}>
      <Scraps falling />
      <div style={{ display: "flex", gap: fit(46), alignItems: "baseline" }}>
        <Slam size={fit(150)} color={SOFT}>A</Slam>
        <Slam size={fit(150)} at={15} color={SOFT}>week</Slam>
        <Slam size={fit(150)} at={30} color={SOFT}>later…</Slam>
      </div>
    </AbsoluteFill>
  );
};

const Gone = () => {
  const frame = useCurrentFrame();
  const { fit } = useShape();
  return <div style={{ opacity: interpolate(frame, [52, 60], [1, 0], clamp) }}><Slam size={fit(310)} color={RED} from={1.7}>Gone.</Slam></div>;
};

// ---- The drop
const Drop = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { fit, square } = useShape();
  const t = spring({ frame, fps, config: { damping: 12, stiffness: 190, mass: 0.8 } });
  return (
    <AbsoluteFill style={center}>
      {[0, 7, 14].map((delay) => {
        const ring = interpolate(frame - delay, [0, 46], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        return <div key={delay} style={{ position: "absolute", width: 2400, height: 2400, borderRadius: "50%", border: `${10 - delay / 2}px solid ${LIGHT_LAVENDER}`, transform: `scale(${ring})`, opacity: frame >= delay ? (1 - ring) * 0.85 : 0 }} />;
      })}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: frame < 60 ? "none" : `translateY(${-interpolate(frame, [60, 72], [0, 40], clamp)}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: fit(44), transform: `scale(${interpolate(t, [0, 1], [3.4, 1])})`, opacity: Math.min(1, frame / 3) }}>
          <Logo size={fit(208)} />
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: fit(218), color: INK, letterSpacing: "-0.05em" }}>Fieldnote</div>
        </div>
        <div style={{ marginTop: fit(50), minHeight: fit(190), textAlign: "center" }}>
          <Slam at={B * 2} size={fit(square ? 92 : 78)} from={1.2}>Talk to people.</Slam>
          <Slam at={B * 3} size={fit(square ? 92 : 78)} color={MUTED} from={1.2} style={{ marginTop: 8 }}>Build what they need.</Slam>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- Record
const Record = () => {
  const frame = useCurrentFrame();
  const { panel, fit, square } = useShape();
  const absolute = frame + 21 * B;
  const speaking = frame >= 16;
  const elapsed = Math.floor(interpolate(frame, [0, 210], [0, 2291], clamp));
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const bars = square ? 44 : 64;
  const keys: Key[] = [[0, 1, 0, 0], [60, 1.62, 400, 330], [90, 1.28, 0, 40], [120, 2.05, -1120, 500], [150, 1, 0, -70]];
  return (
    <Punch keys={keys}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Rise distance={60} style={{ width: panel, padding: square ? 38 : 50, background: SURFACE_2, borderRadius: 26, border: `4px solid ${speaking ? VOICE : LINE}`, boxShadow: speaking ? `0 0 ${60 + 90 * (energy[absolute] ?? 0)}px ${VOICE}33` : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: RED, opacity: 0.45 + 0.55 * Math.abs(Math.sin(frame / 18)) }} />
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: square ? 50 : 66, color: speaking ? VOICE : SOFT, letterSpacing: "-0.03em" }}>{speaking ? "Someone is speaking" : "Listening…"}</div>
            <div style={{ marginLeft: "auto", fontFamily: MONO, fontWeight: 600, fontSize: square ? 62 : 84, color: INK }}>{clock}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: square ? 6 : 8, height: square ? 330 : 420, marginTop: 30 }}>
            {Array.from({ length: bars }, (_, i) => {
              const sample = absolute - (bars - 1 - i) * 3;
              const level = (energy[Math.max(0, sample)] ?? 0) * (0.5 + 0.5 * random(`bar-${i}-${Math.floor(sample / 15)}`));
              return <div key={i} style={{ flex: 1, height: `${Math.max(4, Math.pow(level, 1.15) * 100)}%`, borderRadius: 7, background: speaking && sample >= 21 * B + 16 ? VOICE : "#4a4d57" }} />;
            })}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 30 }}>
            <div style={{ padding: "18px 30px", borderRadius: 14, background: "#c94a4a", color: "#fff", fontFamily: SANS, fontWeight: 600, fontSize: 36 }}>Stop and save</div>
            <div style={{ padding: "18px 30px", borderRadius: 14, border: `2px solid ${LINE}`, color: INK, fontFamily: SANS, fontWeight: 600, fontSize: 36 }}>Pause</div>
          </div>
        </Rise>
        <div style={{ height: 0, overflow: "visible", marginTop: 26 }}>
          <Slam at={150} size={fit(78)} color={INK} weight={600} from={1.15} style={{ whiteSpace: "nowrap" }}>You’ll know it’s really listening.</Slam>
        </div>
      </div>
    </Punch>
  );
};

// ---- Ask
const questions = [
  ["What would you like to talk about today?", "Getting my team set up in one place."],
  ["What has been difficult?", "Inviting people took me three attempts."],
  ["What would you change?", "Let me resend an invite in one click."],
];

const Ask = () => {
  const frame = useCurrentFrame();
  const { panel, square } = useShape();
  const span = 50;
  const position = Math.min(frame / span, 2.999);
  const whole = Math.floor(position);
  const offset = whole + Easing.bezier(0.7, 0, 0.2, 1)(Math.max(0, (position - whole - 0.8) / 0.2));
  const cardHeight = square ? 420 : 440;
  return (
    <AbsoluteFill style={center}>
      <div style={{ height: cardHeight, width: panel, position: "relative" }}>
        {questions.map(([question, answer], i) => {
          const chars = Math.floor(interpolate(frame, [i * span + 3, i * span + 36], [0, answer.length], clamp));
          const distance = i - (i === 2 && frame >= 2 * span ? 2 : offset);
          return (
            <div key={question} style={{ position: "absolute", inset: 0, padding: square ? "36px 42px" : "44px 54px", background: SURFACE, borderRadius: 26, border: `3px solid ${Math.abs(distance) < 0.5 ? LAVENDER : LINE}`, transform: `translateY(${distance * (cardHeight + 40)}px) scale(${1 - Math.min(1, Math.abs(distance)) * 0.06})`, opacity: 1 - Math.min(1, Math.abs(distance)) * 0.65 }}>
              <div style={{ fontFamily: SANS, fontSize: square ? 44 : 56, color: SOFT, fontWeight: 500, letterSpacing: "-0.025em" }}>
                <span style={{ fontFamily: MONO, color: MUTED, marginRight: 20 }}>0{i + 1}</span>{question}
              </div>
              <div style={{ marginTop: 30, padding: "30px 36px", minHeight: square ? 210 : 190, background: SURFACE_2, borderRadius: 18, border: `2px solid ${LINE}`, fontFamily: SANS, fontSize: square ? 58 : 76, lineHeight: 1.15, fontWeight: 550, color: INK, letterSpacing: "-0.03em" }}>
                {answer.slice(0, chars)}
                {Math.abs(distance) < 0.5 && chars < answer.length ? <span style={{ color: LIGHT_LAVENDER }}>▍</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---- Compare
const rows = [
  ["Call with Alex", "Northwind", "Yes", "12"],
  ["Pricing chat with Priya", "Brightline", "Maybe", "40"],
  ["First look with Jordan", "Fernway", "Yes", "6"],
  ["Follow-up with Sam", "Harbor & Co", "No", "3"],
  ["Support call with Maya", "Quill Studio", "Maybe", "18"],
];

const Compare = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { panel, square } = useShape();
  const filterAt = B * 3;
  const filtered = interpolate(frame, [filterAt, filterAt + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const columns = square ? "2.1fr 1.15fr 0.85fr" : "2.5fr 1.45fr 1fr 0.6fr";
  const cell: CSSProperties = { fontFamily: SANS, fontSize: square ? 33 : 44, color: INK, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", letterSpacing: "-0.015em" };
  const rowHeight = square ? 112 : 118;
  return (
    <Punch keys={[[0, 1, 0, 0], [filterAt, 1.1, 0, 0]]}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: panel, background: SURFACE, borderRadius: 26, border: `3px solid ${LINE}`, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: columns, gap: 20, padding: "24px 40px", background: SURFACE_2, borderBottom: `3px solid ${LINE}`, alignItems: "center" }}>
            {["Session", "Company", "Follow up", ...(square ? [] : ["Team"])].map((heading) => <div key={heading} style={{ ...cell, color: MUTED, fontSize: square ? 30 : 36, fontWeight: 500 }}>{heading}</div>)}
          </div>
          {rows.map(([title, company, follow, team], i) => {
            const at = 15 + i * 7.5;
            const keep = follow === "Yes";
            if (frame < at) return <div key={title} style={{ height: rowHeight }} />;
            const t = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 340, mass: 0.6 } });
            return (
              <div key={title} style={{ display: "grid", gridTemplateColumns: columns, gap: 20, padding: "0 40px", height: keep ? rowHeight : rowHeight * (1 - filtered), alignItems: "center", overflow: "hidden", borderBottom: `2px solid ${LINE}`, opacity: keep ? t : t * (1 - filtered), transform: `translateX(${(1 - t) * 140}px)` }}>
                <div style={{ ...cell, fontWeight: 600 }}>{title}</div>
                <div style={{ ...cell, color: SOFT }}>{company}</div>
                <div><span style={{ ...cell, fontSize: square ? 30 : 38, padding: "8px 18px", borderRadius: 10, background: follow === "Yes" ? "#192a22" : follow === "Maybe" ? "#2b261c" : SURFACE_2, color: follow === "Yes" ? "#8cc7a2" : follow === "Maybe" ? "#d8bd87" : MUTED }}>{follow}</span></div>
                {square ? null : <div style={{ ...cell, color: SOFT }}>{team}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ height: 0, overflow: "visible", marginTop: 34 }}>
          {frame >= filterAt ? <Slam at={filterAt} size={square ? 40 : 50} weight={550} from={1.25} color={LIGHT_LAVENDER} style={{ whiteSpace: "nowrap", padding: "16px 30px", border: `3px solid ${LAVENDER}`, borderRadius: 14, letterSpacing: "-0.015em" }}>Follow up is Yes · 2 people to call back</Slam> : null}
        </div>
      </div>
    </Punch>
  );
};

// ---- One click
const OneClick = () => {
  const frame = useCurrentFrame();
  const { width, height, fit } = useShape();
  const clickAt = B * 2;
  const travel = interpolate(frame, [18, clickAt - 2], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.2, 1) });
  const press = frame >= clickAt ? interpolate(frame, [clickAt, clickAt + 4, clickAt + 12], [1, 0.93, 1], clamp) : 1;
  const burst = interpolate(frame, [clickAt + 4, clickAt + 26], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={center}>
      <Slam size={fit(210)} style={{ marginBottom: 80 }}>One click.</Slam>
      <div style={{ display: "flex", alignItems: "center", gap: 26, padding: "34px 50px", borderRadius: 22, background: LAVENDER, color: "#fff", fontFamily: SANS, fontSize: fit(92) + 8, fontWeight: 600, letterSpacing: "-0.03em", transform: `scale(${press})` }}>
        Export all (6)
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}><Claude size={72} /><Codex size={72} /></div>
      </div>
      <svg width="74" height="74" viewBox="0 0 24 24" style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(${interpolate(travel, [0, 1], [width * 0.45, 40])}px, ${interpolate(travel, [0, 1], [height * 0.46, 150])}px)`, filter: "drop-shadow(0 6px 14px #000a)" }}>
        <path fill="#fff" stroke="#111" strokeWidth="1.2" d="M4 2.5v17l4.7-4.4 3 6.6 3-1.4-3-6.5 6.3-.3z" />
      </svg>
      <div style={{ position: "absolute", width: Math.max(width, height) * 1.6, height: Math.max(width, height) * 1.6, borderRadius: "50%", background: LAVENDER, transform: `scale(${burst})` }} />
    </AbsoluteFill>
  );
};

// ---- Folder
const tree = [
  ["fieldnote/", 0, 0],
  ["START-HERE.md", 1, 15],
  ["sessions/", 1, 30],
  ["audio/", 1, 45],
] as const;

const Folder = () => {
  const { fit, square } = useShape();
  return (
    <AbsoluteFill style={{ ...center, flexDirection: square ? "column" : "row", gap: square ? 56 : 110 }}>
      <div style={{ padding: "40px 54px", background: SURFACE, borderRadius: 22, border: `2px solid ${LINE}`, minWidth: square ? 820 : 760, minHeight: square ? 400 : 440 }}>
        {tree.map(([name, depth, at]) => (
          <Rise key={name} at={at} distance={34}>
            <div style={{ fontFamily: MONO, fontSize: square ? 62 : 70, lineHeight: 1.5, color: depth ? SOFT : INK, paddingLeft: depth * 44 }}>{depth ? "├ " : ""}{name}</div>
          </Rise>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: square ? "center" : "flex-start", maxWidth: square ? 900 : 780 }}>
        <Slam at={60} size={fit(square ? 118 : 104)} style={{ textAlign: square ? "center" : "left", transformOrigin: "left" }} from={1.2}>It knows what changed.</Slam>
        <div style={{ display: "flex", gap: 14, marginTop: 36, minHeight: 80 }}>
          {[["1 new", 60, LAVENDER, "#fff"], ["1 edited", 75, "#2b261c", "#d8bd87"], ["4 unchanged", 90, SURFACE_2, SOFT]].map(([text, at, bg, color]) => (
            <Slam key={text as string} at={at as number} size={square ? 42 : 44} weight={550} from={1.6} color={color as string} style={{ padding: "13px 24px", borderRadius: 99, background: bg as string, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{text as string}</Slam>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- Paste into the agent
const AgentCard = ({ icon, name, color, background }: { icon: ReactNode; name: string; color: string; background: string }) => {
  const { fit } = useShape();
  return (
    <AbsoluteFill style={{ ...center, background, flexDirection: "column", gap: 40 }}>
      <Slam size={1} from={2} style={{ fontSize: 0 }}>{icon}</Slam>
      <Slam size={fit(176)} color={color} from={1.3}>{name}</Slam>
    </AbsoluteFill>
  );
};

const typed = (text: string, frame: number, at: number, speed = 1.3) => text.slice(0, Math.max(0, Math.floor((frame - at) * speed)));

const Terminal = () => {
  const frame = useCurrentFrame();
  const { panel, square } = useShape();
  const size = square ? 37 : 46;
  const line: CSSProperties = { fontFamily: MONO, fontSize: size, lineHeight: 1.4, color: SOFT, minHeight: size * 1.4 };
  return (
    <Punch keys={[[0, 1, 0, 0], [84, 1.3, 170, -80], [150, 1, 0, 0]]}>
      <div style={{ width: panel, background: SURFACE, borderRadius: 26, border: `3px solid ${LINE}`, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 36px", borderBottom: `3px solid ${LINE}`, fontFamily: MONO, fontSize: 34, color: MUTED }}>
          <Claude size={46} /><Codex size={46} /><span style={{ marginLeft: 10 }}>~/my-app</span><span style={{ marginLeft: "auto", fontSize: 28 }}>example</span>
        </div>
        <div style={{ padding: "30px 40px", minHeight: square ? 660 : 730 }}>
          <Rise distance={26}>
            <div style={{ ...line, color: INK, background: "#1d2036", padding: "18px 26px", borderRadius: 14, borderLeft: `6px solid ${LAVENDER}` }}>
              <div>Everything is in my-app\fieldnote</div>
              <div style={{ color: LIGHT_LAVENDER }}>1 new session, 1 edited</div>
            </div>
          </Rise>
          <div style={{ marginTop: 28 }}>
            <div style={line}>{frame >= 24 ? <span style={{ color: VOICE }}>● </span> : null}{typed("Reading 2 sessions", frame, 24)}</div>
            <div style={line}>{frame >= 44 ? <span style={{ color: VOICE }}>● </span> : null}{typed("Transcribing 1 recording", frame, 44)}</div>
            <div style={{ ...line, marginTop: 24, color: INK, fontWeight: 700, fontSize: size * 1.24 }}>{typed("3 of 5 people got stuck on invites.", frame, 76, 1.8)}</div>
            <div style={{ ...line, color: "#d8bd87", marginTop: 6 }}>{typed("“It took me three attempts.” (Alex)", frame, 104, 2)}</div>
            <div style={{ ...line, marginTop: 24, color: LIGHT_LAVENDER }}>{typed("What should we do next?", frame, 136, 1.6)}</div>
          </div>
        </div>
      </div>
    </Punch>
  );
};

// ---- The loop
const steps = ["Talk", "Write", "Hand off", "Ship"];

const stepAt = (beat: number) => {
  if (beat < 4) return beat;
  if (beat < 6) return 4 + (beat - 4) * 2;
  return 8 + (beat - 6) * 4;
};

const Loop = () => {
  const frame = useCurrentFrame();
  const { fit, square } = useShape();
  const position = stepAt(frame / B);
  const active = Math.floor(position) % 4;
  const version = 1 + Math.floor(position / 4);
  const size = square ? 620 : 800;
  const lap = position / 4 - Math.floor(position / 4);
  const versionScale = 1 + 0.28 * Math.exp(-lap * (position < 8 ? 9 : 4));
  const radius = size / 2 - 66;
  const angle = (position / 4) * Math.PI * 2 - Math.PI / 2;
  return (
    <AbsoluteFill style={{ ...center, flexDirection: square ? "column" : "row", gap: square ? 40 : 120 }}>
      <div style={{ width: size, height: size, position: "relative" }}>
        <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={LINE} strokeWidth={6} />
          <circle cx={size / 2 + Math.cos(angle) * radius} cy={size / 2 + Math.sin(angle) * radius} r={18} fill={LIGHT_LAVENDER} />
        </svg>
        {steps.map((step, i) => {
          const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
          const on = i === active;
          return (
            <div key={step} style={{ position: "absolute", left: size / 2 + Math.cos(a) * radius, top: size / 2 + Math.sin(a) * radius, transform: `translate(-50%, -50%) scale(${on ? 1.14 : 1})`, padding: "14px 26px", borderRadius: 14, whiteSpace: "nowrap", background: on ? LAVENDER : SURFACE_2, border: `2px solid ${on ? LIGHT_LAVENDER : LINE}`, color: on ? "#fff" : SOFT, fontFamily: SANS, fontWeight: 600, fontSize: square ? 38 : 46 }}>{step}</div>
          );
        })}
        <AbsoluteFill style={center}>
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: square ? 150 : 200, color: INK, letterSpacing: "-0.05em", transform: `scale(${versionScale})` }}>v{version}</div>
        </AbsoluteFill>
      </div>
      <div style={{ maxWidth: square ? 960 : 720, textAlign: square ? "center" : "left" }}>
        <Slam size={fit(square ? 114 : 112)} style={{ textAlign: "inherit", transformOrigin: "left" }} from={1.2}>Talk. Ship. Repeat.</Slam>
        <div style={{ marginTop: 28, minHeight: fit(130) }}>
          <Slam at={B * 2} size={fit(square ? 68 : 56)} color={SOFT} weight={500} style={{ textAlign: "inherit", lineHeight: 1.18, letterSpacing: "-0.03em", transformOrigin: "left" }} from={1.12}>Every conversation makes the next build better.</Slam>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- The end card
const End = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { fit, square } = useShape();
  const t = spring({ frame, fps, config: { damping: 13, stiffness: 170, mass: 0.8 } });
  return (
    <AbsoluteFill style={center}>
      {[0, 8].map((delay) => {
        const ring = interpolate(frame - delay, [0, 52], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        return <div key={delay} style={{ position: "absolute", width: 2400, height: 2400, borderRadius: "50%", border: `8px solid ${LIGHT_LAVENDER}`, transform: `scale(${ring})`, opacity: frame >= delay ? (1 - ring) * 0.7 : 0 }} />;
      })}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${interpolate(t, [0, 1], [1.5, 1])})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: fit(40) }}>
          <Logo size={fit(176)} />
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: fit(186), color: INK, letterSpacing: "-0.05em" }}>Fieldnote</div>
        </div>
        <Slam at={B * 2} size={fit(square ? 88 : 68)} weight={550} from={1.15} style={{ marginTop: 34, letterSpacing: "-0.035em" }}>Talk to people. Build what they need.</Slam>
        <div style={{ display: "flex", gap: 14, marginTop: 44, minHeight: 74 }}>
          {["Free", "Open source", "No account"].map((text, i) => (
            <Slam key={text} at={B * 3 + i * 15} size={square ? 36 : 40} weight={550} from={1.5} color={SOFT} style={{ padding: "11px 26px", borderRadius: 99, background: SURFACE_2, border: `2px solid ${LINE}`, letterSpacing: "-0.01em" }}>{text}</Slam>
          ))}
        </div>
        <Rise at={B * 4} distance={30} style={{ marginTop: 46 }}>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: square ? 50 : 58, color: LIGHT_LAVENDER, letterSpacing: "-0.02em" }}>indkhan.github.io/Fieldnote</div>
        </Rise>
        <Rise at={B * 4.5} distance={18} style={{ marginTop: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: SANS, fontSize: 30, color: MUTED }}>Hand off to <Claude size={34} /> <span style={{ color: SOFT }}>Claude Code</span> <Codex size={34} /> <span style={{ color: SOFT }}>Codex</span></div>
        </Rise>
      </div>
      <div style={{ position: "absolute", bottom: 26, fontFamily: SANS, fontSize: 19, color: "#62666d", textAlign: "center", padding: "0 40px" }}>People in this video are fictional. Independent project, not affiliated with Anthropic or OpenAI.</div>
    </AbsoluteFill>
  );
};

// ---- Global layers
const FLASH_BEATS = [16, 21, 29, 35, 40, 44, 50, 56, 64];

const Flash = () => {
  const frame = useCurrentFrame();
  const since = Math.min(...FLASH_BEATS.map((beat) => (frame >= beat * B ? frame - beat * B : Infinity)));
  const opacity = since === Infinity ? 0 : interpolate(since, [0, 8], [0.5, 0], clamp);
  return <AbsoluteFill style={{ background: "#fff", opacity, pointerEvents: "none" }} />;
};

const Pulse = ({ children }: { children: ReactNode }) => {
  const frame = useCurrentFrame();
  const inDrop = frame >= 16 * B && frame < 64 * B;
  const since = frame % B;
  const scale = inDrop ? 1 + 0.011 * Math.exp(-since / 5) : 1;
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};

const Bug = () => {
  const frame = useCurrentFrame();
  const beat = frame / B;
  const visible = [[21, 28], [29, 34], [35, 40], [44, 48], [50, 64]].some(([from, to]) => beat >= from && beat < to);
  if (!visible) return null;
  return (
    <div style={{ position: "absolute", left: 36, bottom: 30, display: "flex", alignItems: "center", gap: 12, fontFamily: SANS, fontWeight: 600, fontSize: 28, color: INK, opacity: 0.85 }}>
      <Logo size={38} />Fieldnote
    </div>
  );
};

export const Film = () => (
  <AbsoluteFill style={{ background: CANVAS, overflow: "hidden" }}>
    <Audio src={staticFile("music.wav")} />
    <Pulse>
      <Scene from={0} to={4}><FiveCustomers /></Scene>
      <Scene from={4} to={5} background="#ffffff"><Word text="Great calls." color="#000" /></Scene>
      <Scene from={5} to={6} background={LAVENDER}><Word text="Real problems." color="#fff" /></Scene>
      <Scene from={6} to={7} background="#ffffff"><Word text="Honest feedback." color="#000" /></Scene>
      <Scene from={7} to={8} background={LAVENDER}><Word text="Pure gold." color="#fff" /></Scene>
      <Scene from={8} to={12}><Chaos /></Scene>
      <Scene from={12} to={14}><WeekLater /></Scene>
      <Scene from={14} to={16}><Gone /></Scene>
      <Scene from={16} to={20}><Drop /></Scene>
      <Scene from={20} to={21} background="#ffffff"><Word text="Record it." color="#000" /></Scene>
      <Scene from={21} to={28}><Record /></Scene>
      <Scene from={28} to={29} background={LAVENDER}><Word text="Write it down." color="#fff" /></Scene>
      <Scene from={29} to={34}><Ask /></Scene>
      <Scene from={34} to={35} background="#ffffff"><Word text="Compare it." color="#000" /></Scene>
      <Scene from={35} to={40}><Compare /></Scene>
      <Scene from={40} to={43}><OneClick /></Scene>
      <Scene from={43} to={44} background={LAVENDER}><Word text="All in one folder." color="#fff" /></Scene>
      <Scene from={44} to={48}><Folder /></Scene>
      <Scene from={48} to={49} background="#ffffff"><AgentCard icon={<Claude size={190} />} name="Claude Code" color="#000" background="#ffffff" /></Scene>
      <Scene from={49} to={50} background="#000"><AgentCard icon={<Codex size={190} />} name="Codex" color={INK} background="#000" /></Scene>
      <Scene from={50} to={56}><Terminal /></Scene>
      <Scene from={56} to={64}><Loop /></Scene>
      <Scene from={64} to={72}><End /></Scene>
    </Pulse>
    <Bug />
    <Flash />
  </AbsoluteFill>
);
