package handler

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"aylink-agent/internal/infra/logging"
)

func NewSPAHandler(root string, embedded fs.FS, logger logging.Logger) http.Handler {
	embeddedServer := http.FileServer(http.FS(embedded))
	diskServer := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		requestPath := path.Clean(r.URL.Path)
		if requestPath == "." || requestPath == "/" {
			requestPath = "index.html"
		} else {
			requestPath = strings.TrimPrefix(requestPath, "/")
		}

		targetPath := filepath.Join(root, requestPath)
		if fileExists(targetPath) {
			diskServer.ServeHTTP(w, r)
			return
		}

		if embeddedExists(embedded, requestPath) {
			embeddedServer.ServeHTTP(w, r)
			return
		}

		// Static asset requests should not fall back to the SPA entrypoint.
		// Otherwise browsers can get stuck following redirects for directory-like
		// asset URLs such as /assets/.
		if isStaticAssetRequest(requestPath) {
			http.NotFound(w, r)
			return
		}

		indexPath := filepath.Join(root, "index.html")
		if fileExists(indexPath) {
			http.ServeFile(w, r, indexPath)
			return
		}

		if embeddedExists(embedded, "index.html") {
			req := r.Clone(r.Context())
			req.URL.Path = "/index.html"
			embeddedServer.ServeHTTP(w, req)
			return
		}

		logger.Warn("frontend assets missing", "path", indexPath)
		http.Error(w, "frontend assets not built yet", http.StatusServiceUnavailable)
	})
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func embeddedExists(files fs.FS, path string) bool {
	info, err := fs.Stat(files, path)
	return err == nil && !info.IsDir()
}

func isStaticAssetRequest(requestPath string) bool {
	if requestPath == "assets" || strings.HasPrefix(requestPath, "assets/") {
		return true
	}

	if requestPath == "favicon.ico" || requestPath == "logo.ico" {
		return true
	}

	return path.Ext(requestPath) != ""
}
