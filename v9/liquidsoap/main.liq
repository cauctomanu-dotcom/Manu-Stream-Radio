# Manu Stream Radio V9 — test mount only. Never replace /manustream directly.
# Tested target: Liquidsoap 2.3.x (run liquidsoap --check before enabling).
settings.log.stdout := true
settings.frame.audio.samplerate := 48000

# The Python scheduler is invoked for each NEW track. No scheduled event cuts
# a song already playing. Synchronous requests prevent early queue decisions.
def choose_next() =
  lines = process.read.lines("python3 /opt/manustream-v9/v9/engine.py next")
  path = list.hd(default="", lines)
  if path == "" then
    null()
  else
    request.create(path)
  end
end

managed = request.dynamic(
  id="msr_v9_scheduled",
  synchronous=true,
  prefetch=0,
  retry_delay=0.5,
  choose_next
)

# A separate fallback protects the stream if the scheduler or database fails.
backup = playlist("/srv/msr-v9-media/music")
automatic = fallback(track_sensitive=true, [managed, backup])

# Live takes priority only when a DJ explicitly connects to the studio input.
# Losing the studio or turning off the PC returns automatically to the server.
settings.harbor.bind_addrs := ["0.0.0.0"]
studio = input.harbor(
  "studio",
  port=18005,
  user="source",
  password=environment.get("MSR_HARBOR_PASSWORD")
)
radio = fallback(track_sensitive=false, [studio, automatic])
radio = mksafe(radio)

# Use a DIFFERENT mount during acceptance tests. Existing V8.3 remains on
# /manustream until a deliberately scheduled cutover with rollback.
output.icecast(
  %mp3(bitrate=192, samplerate=48000, stereo=true),
  host=environment.get(default="127.0.0.1", "MSR_ICECAST_HOST"),
  port=8000,
  user="source",
  password=environment.get("MSR_ICECAST_PASSWORD"),
  mount=environment.get(default="/manustream-v9-test", "MSR_ICECAST_MOUNT"),
  name="Manu Stream Radio V9 TEST",
  description="Antenne automatique serveur - test",
  radio
)
