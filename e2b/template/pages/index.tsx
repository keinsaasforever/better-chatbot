import { Player } from "@remotion/player";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

function WelcomeComposition() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background: "#111827",
        color: "white",
        display: "flex",
        fontFamily: "system-ui, sans-serif",
        justifyContent: "center",
        opacity,
      }}
    >
      <h1>Navigator Remotion Sandbox</h1>
    </AbsoluteFill>
  );
}

export default function Home() {
  return (
    <main>
      <h1>Preview ready</h1>
      <p>Replace pages/index.tsx with the generated application.</p>
      <Player
        acknowledgeRemotionLicense
        component={WelcomeComposition}
        compositionHeight={360}
        compositionWidth={640}
        controls
        durationInFrames={120}
        fps={30}
        style={{ maxWidth: 640, width: "100%" }}
      />
    </main>
  );
}
