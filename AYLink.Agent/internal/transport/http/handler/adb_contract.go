package handler

import adbservice "aylink-agent/internal/service/adb"

type ADBStatusResponse = adbservice.StatusResponse

type ADBPairRequest struct {
	Host        string `json:"host"`
	PairingPort int    `json:"pairingPort"`
	PairingCode string `json:"pairingCode"`
}

type ADBPairResponse struct {
	Success     bool   `json:"success"`
	Host        string `json:"host"`
	PairingPort int    `json:"pairingPort"`
}

type ADBPairFailureResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}
