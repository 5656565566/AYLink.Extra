package handler

import "net/http"

const repositoryURL = "https://github.com/5656565566/AYLink.Extra"

type VersionHandler struct {
	agentVersion string
	webVersion   string
	releaseTag   string
}

func NewVersionHandler(agentVersion, webVersion, releaseTag string) *VersionHandler {
	return &VersionHandler{
		agentVersion: agentVersion,
		webVersion:   webVersion,
		releaseTag:   releaseTag,
	}
}

func (h *VersionHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"agentVersion":     h.agentVersion,
		"webVersion":       h.webVersion,
		"version":          h.webVersion,
		"releaseTag":       h.releaseTag,
		"repositoryUrl":    repositoryURL,
		"latestReleaseUrl": repositoryURL + "/releases/latest",
	})
}
