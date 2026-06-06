package scrcpy

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	"aylink-agent/internal/infra/logging"
	"aylink-agent/pkg/adbkit"
)

var (
	appLinePattern      = regexp.MustCompile(`^\s*[\*\-]\s*(.*?)\s+([a-zA-Z][\w\.]+)\s*$`)
	audioEncoderPattern = regexp.MustCompile(`--audio-codec=(\S+)\s+--audio-encoder=(\S+)`)
	encoderNamePattern  = regexp.MustCompile(`--(?:video|audio)-encoder=(\S+)`)
)

const serverStartupGrace = 2 * time.Second
const serverStartupProbeInterval = 100 * time.Millisecond
const serverStartupProbeCommandTimeout = 300 * time.Millisecond

type Service struct {
	logger     logging.Logger
	client     *adbkit.Client
	serverPath string
	version    string
}

func NewService(logger logging.Logger, host string, port int, adbBinaryPath string, configuredServerPath string) *Service {
	return &Service{
		logger: logger,
		client: adbkit.NewClientWithOptions(adbkit.ClientOptions{
			Host: host,
			Port: port,
			Bin:  adbBinaryPath,
		}),
		serverPath: resolveServerPath(configuredServerPath),
		version:    "4.0",
	}
}

func (s *Service) IsAvailable() bool {
	return s.serverPath != ""
}

func (s *Service) ServerPath() string {
	return s.serverPath
}

func (s *Service) ListEncoders(ctx context.Context, serial string) ([]string, error) {
	output, err := s.runQuery(ctx, serial, serverOptions{
		ClientVersion: s.version,
		LogLevel:      "info",
		ListEncoders:  true,
		Cleanup:       false,
	})
	if err != nil {
		return nil, err
	}

	seen := map[string]struct{}{}
	result := make([]string, 0)
	for _, match := range encoderNamePattern.FindAllStringSubmatch(output, -1) {
		if len(match) < 2 {
			continue
		}
		name := strings.TrimSpace(match[1])
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result, nil
}

func (s *Service) ListApps(ctx context.Context, serial string) ([]domainscrcpy.AppInfo, error) {
	output, err := s.runQuery(ctx, serial, serverOptions{
		ClientVersion: s.version,
		LogLevel:      "info",
		ListApps:      true,
		Cleanup:       false,
	})
	if err != nil {
		return nil, err
	}

	apps := make([]domainscrcpy.AppInfo, 0)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		match := appLinePattern.FindStringSubmatch(line)
		if len(match) < 3 {
			continue
		}
		apps = append(apps, domainscrcpy.AppInfo{
			Name:        strings.TrimSpace(match[1]),
			PackageName: strings.TrimSpace(match[2]),
		})
	}
	return apps, nil
}

func (s *Service) ListAudioEncoderOptions(ctx context.Context, serial string) ([]domainscrcpy.AudioEncoderOption, error) {
	output, err := s.runQuery(ctx, serial, serverOptions{
		ClientVersion: s.version,
		LogLevel:      "info",
		ListEncoders:  true,
		Cleanup:       false,
	})
	if err != nil {
		return nil, err
	}

	options := make([]domainscrcpy.AudioEncoderOption, 0)
	for _, match := range audioEncoderPattern.FindAllStringSubmatch(output, -1) {
		if len(match) < 2 {
			continue
		}
		codec := strings.TrimSpace(match[1])
		encoder := strings.TrimSpace(match[2])
		if codec == "" || encoder == "" {
			continue
		}
		options = append(options, domainscrcpy.AudioEncoderOption{Codec: codec, Encoder: encoder})
	}
	return options, nil
}

func (s *Service) StartSession(ctx context.Context, serial string, config domainscrcpy.SessionConfig) (*domainscrcpy.Session, error) {
	device := s.client.Device(adbkit.DeviceWithSerial(serial))
	if err := s.pushServer(device); err != nil {
		return nil, err
	}

	sanitizeVideoEncoder(&config)

	needsRepush := false
	if config.Audio {
		needsRepush = true
		if options, err := s.ListAudioEncoderOptions(ctx, serial); err == nil {
			selectBestAudioEncoder(&config, options)
		}
	}

	// 只有查询了音频编码器才需要
	if needsRepush {
		if err := s.pushServer(device); err != nil {
			return nil, err
		}
	}

	scid := 10_000_000 + rand.IntN(20_000_000)
	options := newServerOptionsFromConfig(s.version, scid, config)
	options.LogLevel = "info"
	command := options.CommandString()

	s.logger.Info("scrcpy", "command", command)

	shellCtx := context.WithoutCancel(ctx)
	shellSession, err := device.OpenShellSessionContext(shellCtx, adbkit.ShellSessionOptions{
		Command: command,
		Pty:     false,
	})
	if err != nil {
		return nil, err
	}

	ports := &domainscrcpy.Session{}
	ports.SCID = scid

	select {
	case <-ctx.Done():
		_ = shellSession.Close()
		return nil, ctx.Err()
	case <-time.After(300 * time.Millisecond):
	}

	if options.Video {
		port, err := allocateTCPPort()
		if err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		if _, err := device.Forward(fmt.Sprintf("tcp:%d", port), fmt.Sprintf("localabstract:scrcpy_%d", scid)); err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		ports.VideoPort = port
	}

	if options.Audio {
		port, err := allocateTCPPort()
		if err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		if _, err := device.Forward(fmt.Sprintf("tcp:%d", port), fmt.Sprintf("localabstract:scrcpy_%d", scid)); err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		ports.AudioPort = port
	}

	if options.Control {
		port, err := allocateTCPPort()
		if err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		if _, err := device.Forward(fmt.Sprintf("tcp:%d", port), fmt.Sprintf("localabstract:scrcpy_%d", scid)); err != nil {
			_ = shellSession.Close()
			return nil, err
		}
		ports.ControlPort = port
	}

	go func() {
		pipeReader, pipeWriter := io.Pipe()
		defer pipeReader.Close()
		defer pipeWriter.Close()
		defer shellSession.Close()

		go func() {
			defer pipeWriter.Close()
			for {
				packet, err := shellSession.ReadPacket()
				if err != nil {
					if err != io.EOF {
						s.logger.Warn("scrcpy shell packet read failed", "serial", serial, "scid", scid, "err", err)
					}
					return
				}

				switch packet.ID {
				case adbkit.ShellPacketStdout, adbkit.ShellPacketStderr:
					if len(packet.Data) == 0 {
						continue
					}
					if _, err := pipeWriter.Write(packet.Data); err != nil {
						return
					}
				case adbkit.ShellPacketExit:
					s.logger.Info("scrcpy shell session exit", "serial", serial, "scid", scid, "code", strings.TrimSpace(string(packet.Data)))
					return
				}
			}
		}()

		scanner := bufio.NewScanner(pipeReader)
		buffer := make([]byte, 0, 16*1024)
		scanner.Buffer(buffer, 512*1024)

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			s.logger.Info("scrcpy", "serial", serial, "scid", scid, "line", line)
		}

		if err := scanner.Err(); err != nil {
			s.logger.Warn("scrcpy server stream ended with error", "serial", serial, "scid", scid, "err", err)
			return
		}
		s.logger.Info("scrcpy server stream ended", "serial", serial, "scid", scid)
	}()

	// 设备端创建 scrcpy localabstract socket 存在启动竞态 尤其是到安卓设备延迟高
	// 若客户端过早连接转发端口 adbd 会报 "failed to connect to socket"
	// 然后本地读到 EOF 表现为首帧始终无法到达
	// 轮询设备侧 socket 是否已经就绪 防止过早连接
	if err := s.waitForServerReady(ctx, device, scid); err != nil {
		_ = shellSession.Close()
		return nil, err
	}

	s.logger.Info("scrcpy session started", "serial", serial, "scid", scid, "videoPort", ports.VideoPort, "audioPort", ports.AudioPort, "controlPort", ports.ControlPort)
	return ports, nil
}

func (s *Service) waitForServerReady(ctx context.Context, device *adbkit.Device, scid int) error {
	socketName := fmt.Sprintf("scrcpy_%d", scid)
	deadline := time.NewTimer(serverStartupGrace)
	defer deadline.Stop()

	ticker := time.NewTicker(serverStartupProbeInterval)
	defer ticker.Stop()

	checkReady := func() bool {
		probeCtx, cancel := context.WithTimeout(ctx, serverStartupProbeCommandTimeout)
		defer cancel()

		output, err := device.RunCommandContext(probeCtx, "cat /proc/net/unix")
		if err != nil {
			return false
		}
		return strings.Contains(output, socketName)
	}

	if checkReady() {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return nil
		case <-ticker.C:
			if checkReady() {
				return nil
			}
		}
	}
}

func (s *Service) runQuery(ctx context.Context, serial string, options serverOptions) (string, error) {
	device := s.client.Device(adbkit.DeviceWithSerial(serial))
	if err := s.pushServer(device); err != nil {
		return "", err
	}
	return device.RunCommandContext(ctx, options.CommandString())
}

func (s *Service) pushServer(device *adbkit.Device) error {
	if s.serverPath == "" {
		return fmt.Errorf("scrcpy server file not found")
	}

	reader, err := os.Open(s.serverPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	return device.Push(reader, "/data/local/tmp/scrcpy-server", 0644)
}

func resolveServerPath(configuredPath string) string {
	candidates := []string{}
	if strings.TrimSpace(configuredPath) != "" {
		candidates = append(candidates, configuredPath)
	}

	candidates = append(candidates,
		filepath.Join(".", "Scrcpy", "scrcpy-server"),
		filepath.Join(".", "scrcpy-server"),
		filepath.Join("..", "AYLink.Agent.Old", "Scrcpy", "scrcpy-server"),
		filepath.Join("AYLink.Agent.Old", "Scrcpy", "scrcpy-server"),
	)

	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		info, err := os.Stat(abs)
		if err == nil && !info.IsDir() {
			return abs
		}
	}
	return ""
}

func allocateTCPPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()

	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected addr type %T", listener.Addr())
	}
	return address.Port, nil
}

type serverOptions struct {
	ClientVersion string
	Scid          int
	LogLevel      string
	Video         bool
	Audio         bool
	Control       bool

	VideoCodec   string
	AudioCodec   string
	VideoSource  string
	AudioSource  string
	AudioDup     bool
	VideoEncoder string
	AudioEncoder string
	CodecOptions string

	NewDisplay          string
	FlexDisplay         bool
	VdDestroyContent    bool
	VdSystemDecorations bool
	MaxSize             *int
	VideoBitRate        *int
	AudioBitRate        *int
	MaxFps              *float64
	DisplayID           *int

	CameraFacing    string
	CameraID        string
	CameraSize      string
	CameraFps       string
	CameraHighSpeed bool

	ShowTouches      bool
	StayAwake        bool
	PowerOn          bool
	PowerOffOnClose  bool
	ScreenOffTimeout *int
	HidKeyboard      bool
	HidMouse         bool
	SendDummyByte    bool
	Cleanup          bool

	ListEncoders bool
	ListApps     bool
}

func newServerOptionsFromConfig(version string, scid int, config domainscrcpy.SessionConfig) serverOptions {
	return serverOptions{
		ClientVersion:       version,
		Scid:                scid,
		LogLevel:            "info",
		Video:               config.Video,
		Audio:               config.Audio,
		Control:             config.Control,
		VideoCodec:          fallback(config.VideoCodec, "h264"),
		AudioCodec:          fallback(config.AudioCodec, "opus"),
		VideoSource:         fallback(config.VideoSource, "display"),
		AudioSource:         fallback(config.AudioSource, "output"),
		AudioDup:            config.AudioDup,
		VideoEncoder:        config.VideoEncoder,
		AudioEncoder:        config.AudioEncoder,
		CodecOptions:        config.CodecOptions,
		NewDisplay:          config.NewDisplay,
		FlexDisplay:         config.FlexDisplay,
		VdDestroyContent:    config.VdDestroyContent,
		VdSystemDecorations: config.VdSystemDecorations,
		MaxSize:             config.MaxSize,
		VideoBitRate:        config.VideoBitRate,
		AudioBitRate:        config.AudioBitRate,
		MaxFps:              config.MaxFps,
		DisplayID:           config.DisplayID,
		CameraFacing:        config.CameraFacing,
		CameraID:            config.CameraID,
		CameraSize:          config.CameraSize,
		CameraFps:           config.CameraFps,
		CameraHighSpeed:     config.CameraHighSpeed,
		ShowTouches:         config.ShowTouches,
		StayAwake:           config.StayAwake,
		PowerOn:             config.PowerOn,
		PowerOffOnClose:     config.PowerOffOnClose,
		ScreenOffTimeout:    config.ScreenOffTimeout,
		HidKeyboard:         config.HidKeyboard,
		HidMouse:            config.HidMouse,
		SendDummyByte:       false,
		Cleanup:             true,
	}
}

func (o serverOptions) CommandString() string {
	return strings.Join(o.Args(), " ")
}

func (o serverOptions) Args() []string {
	args := []string{
		"CLASSPATH=/data/local/tmp/scrcpy-server",
		"app_process",
		"/",
		"com.genymobile.scrcpy.Server",
		o.ClientVersion,
		"log_level=" + fallback(o.LogLevel, "info"),
	}

	if o.ListEncoders {
		return append(args, "list_encoders=true")
	}
	if o.ListApps {
		return append(args, "list_apps=true")
	}

	args = append(args, "scid="+strconv.Itoa(o.Scid))
	args = append(args, "video="+strconv.FormatBool(o.Video))
	args = append(args, "audio="+strconv.FormatBool(o.Audio))
	args = append(args, "video_codec="+fallback(o.VideoCodec, "h264"))
	args = append(args, "audio_codec="+fallback(o.AudioCodec, "opus"))
	args = append(args, "video_source="+fallback(o.VideoSource, "display"))
	args = append(args, "audio_source="+fallback(o.AudioSource, "output"))
	args = append(args, "audio_dup="+strconv.FormatBool(o.AudioDup))

	appendIfValue(&args, "video_encoder", o.VideoEncoder)
	appendIfValue(&args, "audio_encoder", o.AudioEncoder)
	appendIfValue(&args, "codec_options", o.CodecOptions)
	appendIfInt(&args, "max_size", o.MaxSize)
	if o.NewDisplay != "" {
		if strings.TrimSpace(o.NewDisplay) == "" {
			args = append(args, "new_display=")
		} else {
			args = append(args, "new_display="+strings.TrimSpace(o.NewDisplay))
		}
	}
	if o.FlexDisplay {
		args = append(args, "flex_display=true")
	}
	if !o.VdDestroyContent {
		args = append(args, "vd_destroy_content=false")
	}
	if !o.VdSystemDecorations {
		args = append(args, "vd_system_decorations=false")
	}
	appendIfInt(&args, "video_bit_rate", o.VideoBitRate)
	appendIfInt(&args, "audio_bit_rate", o.AudioBitRate)
	if o.MaxFps != nil {
		args = append(args, "max_fps="+strconv.FormatFloat(*o.MaxFps, 'f', -1, 64))
	}

	args = append(args, "tunnel_forward=true")
	args = append(args, "control="+strconv.FormatBool(o.Control))
	appendIfInt(&args, "display_id", o.DisplayID)
	appendIfValue(&args, "camera_id", o.CameraID)
	appendIfValue(&args, "camera_facing", o.CameraFacing)
	appendIfValue(&args, "camera_size", o.CameraSize)
	appendIfValue(&args, "camera_fps", o.CameraFps)
	if o.CameraHighSpeed {
		args = append(args, "camera_high_speed=true")
	}
	args = append(args, "show_touches="+strconv.FormatBool(o.ShowTouches))
	args = append(args, "stay_awake="+strconv.FormatBool(o.StayAwake))
	if o.ScreenOffTimeout != nil && *o.ScreenOffTimeout >= 0 {
		appendIfInt(&args, "screen_off_timeout", o.ScreenOffTimeout)
	}
	args = append(args, "power_off_on_close="+strconv.FormatBool(o.PowerOffOnClose))
	args = append(args, "clipboard_autosync=true")
	args = append(args, "downsize_on_error=true")
	args = append(args, "cleanup="+strconv.FormatBool(o.Cleanup))
	args = append(args, "power_on="+strconv.FormatBool(o.PowerOn))
	if o.HidKeyboard {
		args = append(args, "hid_keyboard=true")
	}
	if o.HidMouse {
		args = append(args, "hid_mouse=true")
	}
	if o.SendDummyByte {
		args = append(args, "send_dummy_byte=true")
	}
	return args
}

func selectBestAudioEncoder(config *domainscrcpy.SessionConfig, options []domainscrcpy.AudioEncoderOption) {
	// 按优先级顺序尝试匹配
	codecPriority := []string{"opus", "raw"}
	for _, preferred := range codecPriority {
		for _, opt := range options {
			if strings.EqualFold(opt.Codec, preferred) {
				config.AudioCodec = opt.Codec
				config.AudioEncoder = opt.Encoder
				return
			}
		}
	}
	// 若没有命中优先级列表 则使用第一个可用选项
	config.AudioCodec = string(domainscrcpy.AudioCodecRaw)
	config.AudioEncoder = ""
}

func sanitizeVideoEncoder(config *domainscrcpy.SessionConfig) {
	if config == nil {
		return
	}

	codec := normalizeVideoCodecName(config.VideoCodec)
	if codec == "" {
		codec = "h264"
	}

	encoderCodec := detectVideoEncoderCodec(config.VideoEncoder)
	if encoderCodec == "" || encoderCodec == codec {
		return
	}

	config.VideoEncoder = ""
}

func normalizeVideoCodecName(codec string) string {
	switch strings.ToLower(strings.TrimSpace(codec)) {
	case "h265", "hevc":
		return "h265"
	case "h264", "avc":
		return "h264"
	case "av1":
		return "av1"
	default:
		return ""
	}
}

func detectVideoEncoderCodec(encoder string) string {
	name := strings.ToLower(strings.TrimSpace(encoder))
	if name == "" {
		return ""
	}

	switch {
	case strings.Contains(name, "hevc"), strings.Contains(name, "h265"):
		return "h265"
	case strings.Contains(name, "avc"), strings.Contains(name, "h264"):
		return "h264"
	case strings.Contains(name, "av1"):
		return "av1"
	default:
		return ""
	}
}

func appendIfValue(args *[]string, key, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	*args = append(*args, key+"="+value)
}

func appendIfInt(args *[]string, key string, value *int) {
	if value == nil {
		return
	}
	*args = append(*args, key+"="+strconv.Itoa(*value))
}

func fallback(value, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}
