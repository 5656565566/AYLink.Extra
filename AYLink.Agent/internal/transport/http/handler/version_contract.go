package handler

type VersionResponse struct {
	AgentVersion     string `json:"agentVersion"`
	WebVersion       string `json:"webVersion"`
	Version          string `json:"version"`
	ReleaseTag       string `json:"releaseTag"`
	RepositoryURL    string `json:"repositoryUrl"`
	LatestReleaseURL string `json:"latestReleaseUrl"`
}
