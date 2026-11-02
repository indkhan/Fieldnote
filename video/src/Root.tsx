import { Composition } from "remotion";
import { Film } from "./Film";
import timeline from "./timeline.json";

const durationInFrames = timeline.beats * (timeline.fps * 60) / timeline.bpm;

export const Root = () => (
  <>
    <Composition id="Fieldnote-Landscape" component={Film} durationInFrames={durationInFrames} fps={timeline.fps} width={1920} height={1080} />
    <Composition id="Fieldnote-Square" component={Film} durationInFrames={durationInFrames} fps={timeline.fps} width={1080} height={1080} />
  </>
);
