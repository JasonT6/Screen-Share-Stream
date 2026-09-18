import {
  ArrowUpRight,
  Headphones,
  LockKeyhole,
  MonitorPlay,
  Users
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">YOUR PEOPLE. YOUR SCREENS.</p>
          <h1 id="landing-title">
            A screen worth
            <br />
            sharing.
          </h1>
          <p className="landing-intro">
            Bring your people together with screen sharing and sound. Create a
            private room, send the link, and enjoy it together.
          </p>
          <a className="button primary landing-cta" href="#create">
            Create a room <ArrowUpRight size={19} />
          </a>
          <p className="landing-caption">
            Free to start. No account or download.
          </p>
        </div>
        <div className="landing-preview" aria-hidden="true">
          <div className="landing-preview-bar">
            <span className="landing-window-dots">
              <i />
              <i />
              <i />
            </span>
            <span>Your own little screening room</span>
            <LockKeyhole size={15} />
          </div>
          <div className="landing-preview-screen">
            <div className="landing-orbit">
              <MonitorPlay size={64} strokeWidth={1.25} />
            </div>
            <span>Good things are better shared.</span>
          </div>
          <div className="landing-preview-bottom">
            <span>
              <Headphones size={17} /> Screen + sound
            </span>
            <span>
              <Users size={17} /> Your people
            </span>
          </div>
        </div>
      </section>
      <section className="landing-steps" aria-label="How it works">
        <article>
          <span className="landing-step">01</span>
          <h2>Make it yours.</h2>
          <p>
            Pick a username and room password. Share a screen or tab with its
            audio.
          </p>
        </article>
        <article>
          <span className="landing-step">02</span>
          <h2>Send an invitation.</h2>
          <p>
            Copy your unique room link and share the password separately with
            your people.
          </p>
        </article>
        <article>
          <span className="landing-step">03</span>
          <h2>Share the moment.</h2>
          <p>
            Everyone can share a screen. Choose whose stream to watch, with
            sound included.
          </p>
        </article>
      </section>
      <div className="landing-details">
        <p>
          <LockKeyhole size={17} /> Password protected. Media travels directly
          between participants.
        </p>
        <p>Have an invitation? Open your host’s link to join.</p>
      </div>
      <p className="landing-browser-note">
        To share, use desktop Chrome or Edge and enable audio in the screen
        picker. Keep the host tab open while your room is in use.
      </p>
    </div>
  );
}
