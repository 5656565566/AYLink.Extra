package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const defaultAddress = "127.0.0.1:18080"
const defaultAPIBaseURL = "http://127.0.0.1:5501"

func main() {
	addr := flag.String("addr", defaultAddress, "API docs listen address")
	dir := flag.String("dir", "", "Swagger docs directory")
	apiBaseURL := flag.String("api-base-url", defaultAPIBaseURL, "API base URL used by Swagger UI")
	flag.Parse()

	docsDir, err := resolveDocsDir(*dir)
	if err != nil {
		log.Fatal(err)
	}

	if err := ensureSwaggerDocs(docsDir); err != nil {
		log.Fatal(err)
	}

	url := "http://" + *addr + "/"
	fmt.Printf("AYLink Agent API docs: %s\n", url)
	fmt.Printf("Swagger API base URL: %s\n", *apiBaseURL)
	fmt.Printf("Serving static files from: %s\n", docsDir)

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(docsDir)))
	mux.HandleFunc("/swagger.json", func(w http.ResponseWriter, r *http.Request) {
		serveSwaggerJSON(w, r, docsDir, *apiBaseURL)
	})

	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

func resolveDocsDir(value string) (string, error) {
	if value != "" {
		return filepath.Abs(value)
	}

	for _, candidate := range []string{
		filepath.Join("docs", "api"),
		filepath.Join("..", "docs", "api"),
		filepath.Join("..", "..", "docs", "api"),
	} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return filepath.Abs(candidate)
		}
	}

	return "", fmt.Errorf("Swagger docs directory not found; run make api-docs first")
}

func ensureSwaggerDocs(dir string) error {
	for _, name := range []string{"index.html", "swagger.json"} {
		path := filepath.Join(dir, name)
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			return fmt.Errorf("%s not found in %s; run make api-docs first", name, dir)
		}
	}
	return nil
}

func serveSwaggerJSON(w http.ResponseWriter, r *http.Request, docsDir string, apiBaseURL string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	payload, err := os.ReadFile(filepath.Join(docsDir, "swagger.json"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var spec map[string]any
	if err := json.Unmarshal(payload, &spec); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := applyAPIBaseURL(spec, apiBaseURL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(spec); err != nil {
		log.Printf("write swagger.json: %v", err)
	}
}

func applyAPIBaseURL(spec map[string]any, value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("api base URL must include scheme and host")
	}

	spec["schemes"] = []string{parsed.Scheme}
	spec["host"] = parsed.Host
	if parsed.Path == "" {
		spec["basePath"] = "/"
	} else {
		spec["basePath"] = strings.TrimRight(parsed.Path, "/")
		if spec["basePath"] == "" {
			spec["basePath"] = "/"
		}
	}
	return nil
}
