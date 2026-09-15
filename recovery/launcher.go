package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const signature = "MSR-RECOVERY-2026-09-15"

type appServer struct {
	mu      sync.RWMutex
	state   map[string]any
	clients map[chan []byte]struct{}
	images  map[string][]byte
	mimes   map[string]string
	baseDir string
	httpSrv *http.Server
}

func main() {
	baseDir := exeDir()
	logPath := filepath.Join(baseDir, "msr-recovery.log")
	lf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		defer lf.Close()
		log.SetOutput(lf)
	}
	log.Printf("=== %s start ===", signature)

	webDir := filepath.Join(baseDir, "web")
	if _, err := os.Stat(filepath.Join(webDir, "index.html")); err != nil {
		log.Printf("web/index.html missing: %v", err)
		showMessage("Manu Stream Radio", "Le dossier web est incomplet. Réextrais toute l'archive dans un même dossier.")
		return
	}
	if _, err := os.Stat(filepath.Join(webDir, "app.js")); err != nil {
		log.Printf("web/app.js missing: %v", err)
		showMessage("Manu Stream Radio", "Le moteur app.js manque dans l'archive. Réextrais toute l'archive.")
		return
	}

	port := choosePort()
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("listen failed on %s: %v", addr, err)
		showMessage("Manu Stream Radio", "Impossible d'ouvrir le serveur local de la régie. Ferme les anciennes fenêtres Manu Stream Radio puis relance.")
		return
	}

	a := &appServer{
		state: map[string]any{
			"live": false,
			"showName": "Manu Stream — Radio",
			"banner": "STANDBY",
			"title": "Manu Stream Radio",
			"artist": "Votre studio. Votre fréquence.",
			"next": "—",
			"callerName": "",
			"meter": 0,
			"clock": "--:--:--",
		},
		clients: make(map[chan []byte]struct{}),
		images:  make(map[string][]byte),
		mimes:   make(map[string]string),
		baseDir: baseDir,
	}
	a.loadPersistedImage("artwork")
	a.loadPersistedImage("logo")

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, signature)
	})
	mux.HandleFunc("/api/state", a.handleState)
	mux.HandleFunc("/api/image", a.handleImage)
	mux.HandleFunc("/events", a.handleEvents)
	mux.HandleFunc("/artwork", a.handleImageGet("artwork"))
	mux.HandleFunc("/logo", a.handleImageGet("logo"))
	mux.HandleFunc("/api/streamlabs/connect", a.handleStreamlabsUnavailable)
	mux.HandleFunc("/api/streamlabs/action", a.handleStreamlabsUnavailable)
	mux.HandleFunc("/api/streamlabs/status", a.handleStreamlabsUnavailable)
	mux.HandleFunc("/api/quit", a.handleQuit)
	mux.HandleFunc("/overlay", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "overlay.html"))
	})
	mux.Handle("/", noCache(http.FileServer(http.Dir(webDir))))

	a.httpSrv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("serving %s on http://%s", signature, addr)
		if err := a.httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("server error: %v", err)
		}
	}()

	url := fmt.Sprintf("http://127.0.0.1:%d/?build=recovery-stable", port)
	time.Sleep(250 * time.Millisecond)
	if err := openBrowser(url); err != nil {
		log.Printf("browser open failed: %v", err)
		showMessage("Manu Stream Radio", "La régie tourne sur "+url+". Ouvre cette adresse dans Microsoft Edge.")
	}

	select {}
}

func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		d, _ := os.Getwd()
		return d
	}
	return filepath.Dir(exe)
}

func choosePort() int {
	const preferred = 17340
	if canBind(preferred) {
		return preferred
	}
	if looksLikeMSR(preferred) {
		log.Printf("port %d occupied by another MSR instance; requesting clean shutdown", preferred)
		client := &http.Client{Timeout: 900 * time.Millisecond}
		req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/api/quit", preferred), strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		if resp, err := client.Do(req); err == nil {
			_ = resp.Body.Close()
		}
		for i := 0; i < 10; i++ {
			time.Sleep(200 * time.Millisecond)
			if canBind(preferred) {
				return preferred
			}
		}
	}
	for p := 17341; p <= 17349; p++ {
		if canBind(p) {
			return p
		}
	}
	return preferred
}

func canBind(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func looksLikeMSR(port int) bool {
	client := &http.Client{Timeout: 600 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	s := strings.ToLower(string(b))
	return strings.Contains(s, "manu stream radio") || strings.Contains(s, "ouverture de la régie") || strings.Contains(s, "ouverture de la regie")
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		w.Header().Set("Pragma", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func (a *appServer) handleState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method == http.MethodGet {
		a.mu.RLock()
		defer a.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(a.state)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var patch map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&patch); err != nil {
		writeJSONError(w, http.StatusBadRequest, "JSON invalide")
		return
	}
	a.mu.Lock()
	for k, v := range patch {
		a.state[k] = v
	}
	stateCopy := cloneMap(a.state)
	a.mu.Unlock()
	a.broadcast(stateCopy)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "state": stateCopy})
}

func (a *appServer) handleImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Méthode non autorisée")
		return
	}
	var req struct {
		Kind    string `json:"kind"`
		DataURL string `json:"dataURL"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 20<<20)).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "JSON invalide")
		return
	}
	if req.Kind != "artwork" && req.Kind != "logo" {
		writeJSONError(w, http.StatusBadRequest, "Type d'image inconnu")
		return
	}
	if req.DataURL == "" {
		a.mu.Lock()
		delete(a.images, req.Kind)
		delete(a.mimes, req.Kind)
		versionKey := req.Kind + "Version"
		a.state[versionKey] = 0
		stateCopy := cloneMap(a.state)
		a.mu.Unlock()
		a.deletePersistedImage(req.Kind)
		a.broadcast(stateCopy)
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	mimeType, data, err := decodeDataURL(req.DataURL)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Image invalide")
		return
	}
	a.mu.Lock()
	a.images[req.Kind] = data
	a.mimes[req.Kind] = mimeType
	versionKey := req.Kind + "Version"
	a.state[versionKey] = time.Now().UnixMilli()
	stateCopy := cloneMap(a.state)
	a.mu.Unlock()
	a.persistImage(req.Kind, mimeType, data)
	a.broadcast(stateCopy)
	writeJSON(w, map[string]any{"ok": true})
}

func (a *appServer) handleImageGet(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.mu.RLock()
		data := append([]byte(nil), a.images[kind]...)
		mt := a.mimes[kind]
		a.mu.RUnlock()
		if len(data) == 0 {
			http.NotFound(w, r)
			return
		}
		if mt == "" {
			mt = "application/octet-stream"
		}
		w.Header().Set("Content-Type", mt)
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	}
}

func (a *appServer) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := make(chan []byte, 8)
	a.mu.Lock()
	a.clients[ch] = struct{}{}
	initial := cloneMap(a.state)
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.clients, ch)
		a.mu.Unlock()
		close(ch)
	}()
	b, _ := json.Marshal(initial)
	fmt.Fprintf(w, "data: %s\n\n", b)
	flusher.Flush()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ping.C:
			_, _ = io.WriteString(w, ": ping\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (a *appServer) broadcast(state map[string]any) {
	b, _ := json.Marshal(state)
	a.mu.RLock()
	clients := make([]chan []byte, 0, len(a.clients))
	for ch := range a.clients {
		clients = append(clients, ch)
	}
	a.mu.RUnlock()
	for _, ch := range clients {
		select {
		case ch <- b:
		default:
		}
	}
}

func (a *appServer) handleStreamlabsUnavailable(w http.ResponseWriter, r *http.Request) {
	writeJSONError(w, http.StatusServiceUnavailable, "Streamlabs Remote Control n'est pas activé dans cette archive de récupération. La régie audio locale continue de fonctionner.")
}

func (a *appServer) handleQuit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true})
	go func() {
		time.Sleep(180 * time.Millisecond)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if a.httpSrv != nil {
			_ = a.httpSrv.Shutdown(ctx)
		}
		os.Exit(0)
	}()
}

func decodeDataURL(s string) (string, []byte, error) {
	comma := strings.IndexByte(s, ',')
	if comma < 0 {
		return "", nil, fmt.Errorf("bad data url")
	}
	head, payload := s[:comma], s[comma+1:]
	if !strings.HasPrefix(head, "data:") || !strings.Contains(head, ";base64") {
		return "", nil, fmt.Errorf("unsupported data url")
	}
	mt := strings.TrimPrefix(strings.Split(head, ";")[0], "data:")
	if mt == "" {
		mt = "application/octet-stream"
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	return mt, data, err
}

func cloneMap(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": msg})
}

func (a *appServer) imageDir() string {
	return filepath.Join(a.baseDir, "data")
}

func (a *appServer) persistImage(kind, mt string, data []byte) {
	_ = os.MkdirAll(a.imageDir(), 0755)
	_ = os.WriteFile(filepath.Join(a.imageDir(), kind+".bin"), data, 0644)
	_ = os.WriteFile(filepath.Join(a.imageDir(), kind+".mime"), []byte(mt), 0644)
}

func (a *appServer) deletePersistedImage(kind string) {
	_ = os.Remove(filepath.Join(a.imageDir(), kind+".bin"))
	_ = os.Remove(filepath.Join(a.imageDir(), kind+".mime"))
}

func (a *appServer) loadPersistedImage(kind string) {
	data, err := os.ReadFile(filepath.Join(a.imageDir(), kind+".bin"))
	if err != nil || len(data) == 0 {
		return
	}
	mtb, _ := os.ReadFile(filepath.Join(a.imageDir(), kind+".mime"))
	mt := strings.TrimSpace(string(mtb))
	if mt == "" {
		mt = mime.TypeByExtension(filepath.Ext(kind))
	}
	a.images[kind] = data
	a.mimes[kind] = mt
	a.state[kind+"Version"] = time.Now().UnixMilli()
}

func openBrowser(url string) error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("windows only")
	}
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}
	for _, p := range candidates {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			cmd := exec.Command(p, "--app="+url, "--start-maximized", "--disable-background-mode")
			return cmd.Start()
		}
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func showMessage(title, message string) {
	if runtime.GOOS == "windows" {
		ps := fmt.Sprintf("Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(%q,%q)", message, title)
		_ = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps).Run()
	}
}
