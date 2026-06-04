package settings

type WebRtcNetworkSettings struct {
	IceTransportPolicy           string            `json:"IceTransportPolicy"`
	FallbackLocale               string            `json:"FallbackLocale"`
	IceServers                   []WebRtcIceServer `json:"IceServers"`
	HostCandidateOverrideEnabled bool              `json:"HostCandidateOverrideEnabled"`
	HostCandidateOverrideIPs     []string          `json:"HostCandidateOverrideIPs"`
	HostCandidatePortMin         *int              `json:"HostCandidatePortMin,omitempty"`
	HostCandidatePortMax         *int              `json:"HostCandidatePortMax,omitempty"`
	SinglePortMuxEnabled         bool              `json:"SinglePortMuxEnabled"`
	SinglePortMuxBindPort        *int              `json:"SinglePortMuxBindPort,omitempty"`
	SinglePortMuxPublishPort     *int              `json:"SinglePortMuxPublishPort,omitempty"`
}

type WebRtcIceServer struct {
	Urls       []string `json:"Urls"`
	Username   *string  `json:"Username,omitempty"`
	Credential *string  `json:"Credential,omitempty"`
}
