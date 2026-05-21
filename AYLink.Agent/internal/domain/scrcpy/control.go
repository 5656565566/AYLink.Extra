package scrcpy

import "encoding/binary"

const (
	controlMsgTypeStartApp   byte = 16
	controlMsgTypeResetVideo byte = 17
)

func BuildStartAppControl(packageName string) []byte {
	nameBytes := []byte(packageName)
	if len(nameBytes) > 255 {
		nameBytes = nameBytes[:255]
	}

	payload := make([]byte, 0, 2+len(nameBytes))
	payload = append(payload, controlMsgTypeStartApp, byte(len(nameBytes)))
	payload = append(payload, nameBytes...)
	return payload
}

func BuildResetVideoControl() []byte {
	return []byte{controlMsgTypeResetVideo}
}

func BuildUhidDestroyControl(deviceID uint16) []byte {
	payload := make([]byte, 3)
	payload[0] = 14
	binary.BigEndian.PutUint16(payload[1:], deviceID)
	return payload
}
