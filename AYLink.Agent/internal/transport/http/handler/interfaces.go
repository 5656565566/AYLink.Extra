package handler

import (
	"context"
	"io"

	domainadb "aylink-agent/internal/domain/adb"
	domainauth "aylink-agent/internal/domain/auth"
	domaindevice "aylink-agent/internal/domain/device"
	domaini18n "aylink-agent/internal/domain/i18n"
	domainscrcpy "aylink-agent/internal/domain/scrcpy"
	domainsettings "aylink-agent/internal/domain/settings"
	domainwebrtc "aylink-agent/internal/domain/webrtc"
	adbservice "aylink-agent/internal/service/adb"
	appservice "aylink-agent/internal/service/app"
	deviceservice "aylink-agent/internal/service/device"
	fileservice "aylink-agent/internal/service/file"
	scrcpyservice "aylink-agent/internal/service/scrcpy"
	statusservice "aylink-agent/internal/service/status"
	terminalservice "aylink-agent/internal/service/terminal"
	webrtcservice "aylink-agent/internal/service/webrtc"

	"github.com/gorilla/websocket"
)

type AuthService interface {
	Login(ctx context.Context, username, password string) (*domainauth.LoginResult, error)
	Refresh(ctx context.Context, refreshToken string) (*domainauth.LoginResult, error)
	CurrentUser(ctx context.Context, accessToken string) (*domainauth.User, error)
	Logout(ctx context.Context, accessToken, refreshToken string) error
	ChangeOwnPassword(ctx context.Context, userID int, currentPassword, newPassword string) error
	LogoutAll(ctx context.Context, userID int) error
	GetUsers(ctx context.Context) ([]domainauth.User, error)
	CreateUser(ctx context.Context, username, password string, roleIds []int, deviceGroupIds []int) (*domainauth.User, error)
	UpdateUser(ctx context.Context, userID int, username string, isActive bool, roleIds []int, deviceGroupIds []int, actingUserID *int) (*domainauth.User, error)
	DeleteUser(ctx context.Context, userID int, actingUserID *int) error
	ResetPassword(ctx context.Context, userID int, newPassword string) (string, error)
	SetUserActiveState(ctx context.Context, userID int, isActive bool, actingUserID *int) error
	GetRoles(ctx context.Context) ([]domainauth.Role, error)
	CreateRole(ctx context.Context, name, description string, permissions []string, deviceGroupIds []int) (*domainauth.Role, error)
	UpdateRole(ctx context.Context, roleID int, name, description string, permissions []string, deviceGroupIds []int) (*domainauth.Role, error)
	GetAvailablePermissions() []domainauth.PermissionDescriptor
}

type ADBService interface {
	Status(ctx context.Context) (adbservice.StatusResponse, error)
	StartServer(ctx context.Context) error
	KillServer(ctx context.Context) error
	Pair(ctx context.Context, host string, port int, code string) (string, error)
}

type StatusService interface {
	Get(ctx context.Context) statusservice.Response
}

type DeviceService interface {
	List(ctx context.Context) ([]domaindevice.Device, error)
	Create(ctx context.Context, input deviceservice.CreateInput) (*domaindevice.Device, error)
	Delete(ctx context.Context, id int) error
	Connect(ctx context.Context, id int) (*domaindevice.Device, error)
	Rename(ctx context.Context, id int, name string) (*domaindevice.Device, error)
}

type DeviceAccessService interface {
	CanAccessDevice(ctx context.Context, identity *domainauth.Identity, deviceID int) (bool, error)
	FilterDevices(ctx context.Context, identity *domainauth.Identity, devices []domaindevice.Device) ([]domaindevice.Device, error)
}

type DeviceGroupService interface {
	List(ctx context.Context) ([]domaindevice.Group, error)
	ListOptions(ctx context.Context, keyword string) ([]domaindevice.GroupSummary, error)
	ListOptionsForUser(ctx context.Context, userID int, keyword string) ([]domaindevice.GroupSummary, error)
	GetByID(ctx context.Context, id int) (*domaindevice.Group, error)
	Create(ctx context.Context, name, description string) (*domaindevice.Group, error)
	Update(ctx context.Context, id int, name, description string) (*domaindevice.Group, error)
	Delete(ctx context.Context, id int) error
	GetGroupsForDevice(ctx context.Context, deviceID int) ([]domaindevice.GroupSummary, error)
	GetGroupsForDevices(ctx context.Context, deviceIDs []int) (map[int][]domaindevice.GroupSummary, error)
	SetGroupsForDevice(ctx context.Context, deviceID int, groupIDs []int) error
}

type DeviceSettingsService interface {
	GetByDeviceID(ctx context.Context, id int) (domaindevice.SettingsProfile, error)
	SaveByDeviceID(ctx context.Context, id int, profile domaindevice.SettingsProfile) (domaindevice.SettingsProfile, error)
	ResetByDeviceID(ctx context.Context, id int) (domaindevice.SettingsProfile, error)
}

type AppService interface {
	Launch(ctx context.Context, deviceID int, packageName string) error
	Download(ctx context.Context, deviceID int, packageName string) (*appservice.DownloadResult, error)
	Uninstall(ctx context.Context, deviceID int, packageName string) error
	Info(ctx context.Context, deviceID int, packageName string) (*appservice.AppInfoResult, error)
	Install(ctx context.Context, deviceID int, fileName string, reader io.Reader) error
}

type FileService interface {
	List(ctx context.Context, deviceID int, rawPath string) (*fileservice.ListResult, error)
	Download(ctx context.Context, deviceID int, rawPath string) (*fileservice.DownloadResult, error)
	Rename(ctx context.Context, deviceID int, rawPath string, newName string) error
	Delete(ctx context.Context, deviceID int, rawPath string) error
}

type ScrcpyService interface {
	ListEncoders(ctx context.Context, deviceID int) ([]string, error)
	ListApps(ctx context.Context, deviceID int) ([]domainscrcpy.AppInfo, error)
	StartRuntimeForWebRTC(ctx context.Context, deviceID int, options scrcpyservice.WebRTCRuntimeOptions) (domainscrcpy.Runtime, error)
}

type I18NService interface {
	GetLanguages() ([]domaini18n.LanguageOption, error)
	GetLanguage(locale string) (map[string]any, error)
	LocaleExists(locale string) bool
}

type SettingsService interface {
	GetLanguage(ctx context.Context) (string, error)
	SetLanguage(ctx context.Context, locale string) error
	GetWebRtcNetworkSettings(ctx context.Context) (domainsettings.WebRtcNetworkSettings, error)
	SaveWebRtcNetworkSettings(ctx context.Context, settings domainsettings.WebRtcNetworkSettings) (domainsettings.WebRtcNetworkSettings, error)
}

type DevicePreviewService interface {
	Get(ctx context.Context, deviceID int, width int) ([]byte, error)
}

type TerminalSession interface {
	ReadPacket() (domainadb.ShellPacket, error)
	WriteInput(data string) error
	Resize(cols, rows int) error
	CloseInput() error
	Close() error
}

type TerminalService interface {
	Start(ctx context.Context, deviceID int) (*terminalservice.Session, error)
}

type WebRTCService interface {
	CreateTicket(ctx context.Context, input webrtcservice.CreateTicketInput) (webrtcservice.CreateTicketResult, error)
	TouchSession(ctx context.Context, deviceID string, sessionID string) (bool, error)
	ReleaseSession(ctx context.Context, deviceID string, sessionID string) error
	HasActiveSessionLease(deviceID string) bool
	HasSessionLease(deviceID string, sessionID string) bool
	GetVideoStreamHealthSnapshot(sessionID string) (domainwebrtc.VideoStreamHealthSnapshot, error)
	ConsumeTicket(ctx context.Context, value string) (domainwebrtc.Ticket, error)
	MarkSessionStarted(deviceID string, sessionID string)
	HandleSignalWebSocket(ctx context.Context, deviceID string, sessionID string, conn *websocket.Conn, settings webrtcservice.SettingsProvider, runtime domainscrcpy.Runtime) error
}

var _ TerminalSession = (*terminalservice.Session)(nil)
