package scrcpy

import "encoding/binary"

const (
	controlMsgTypeStartApp     byte = 16
	controlMsgTypeResetVideo   byte = 17
	controlMsgTypeGetClipboard byte = 8
	controlMsgTypeSetClipboard byte = 9
	controlMsgClipboardCopyKey byte = 1
	maxClipboardTextLength          = (1 << 18) - 14
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

func BuildGetClipboardControl() []byte {
	return []byte{controlMsgTypeGetClipboard, controlMsgClipboardCopyKey}
}

func BuildSetClipboardControl(sequence uint64, text string, paste bool) []byte {
	textBytes := []byte(text)
	if len(textBytes) > maxClipboardTextLength {
		textBytes = textBytes[:maxClipboardTextLength]
	}

	payload := make([]byte, 14+len(textBytes))
	payload[0] = controlMsgTypeSetClipboard
	binary.BigEndian.PutUint64(payload[1:9], sequence)
	if paste {
		payload[9] = 1
	}
	binary.BigEndian.PutUint32(payload[10:14], uint32(len(textBytes)))
	copy(payload[14:], textBytes)
	return payload
}

func BuildUhidDestroyControl(deviceID uint16) []byte {
	payload := make([]byte, 3)
	payload[0] = 14
	binary.BigEndian.PutUint16(payload[1:], deviceID)
	return payload
}
