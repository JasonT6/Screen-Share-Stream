// Test-only local rendezvous. It never carries the test video or audio.
import { PeerServer } from "peer";
PeerServer({ host: "127.0.0.1", port: 9001, path: "/" });
