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

// Get 获取应用版本
// @Summary 获取应用版本
// @Description 返回 Agent、Web 和发布相关版本信息。
// @Tags 状态
// @Produce json
// @Success 200 {object} VersionResponse
// @Failure 405 {object} ErrorResponse
// @Router /api/app/version [get]
func (h *VersionHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	WriteJSON(w, http.StatusOK, VersionResponse{
		AgentVersion:     h.agentVersion,
		WebVersion:       h.webVersion,
		Version:          h.webVersion,
		ReleaseTag:       h.releaseTag,
		RepositoryURL:    repositoryURL,
		LatestReleaseURL: repositoryURL + "/releases/latest",
	})
}
