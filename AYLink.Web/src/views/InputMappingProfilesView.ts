import { computed, defineComponent, onActivated, onMounted, ref } from 'vue';
import {
  ArrowDownload20Regular,
  CheckmarkCircle20Regular,
  Delete20Regular,
  Edit20Regular
} from '@vicons/fluent';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { useNotification } from '../services/notification';
import {
  type InputMappingProfile,
  type InputMappingProfileSummary
} from '../features/inputMapping/inputMappingSchema';
import { createLocalInputMappingProfileStore } from '../features/inputMapping/inputMappingProfileStore';
import { getInputMappingTabState, setInputMappingTabState } from '../features/inputMapping/inputMappingTabState';
import { sanitizeDownloadFileName } from '../lib/input/normalize';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default defineComponent({
  name: 'InputMappingProfilesView',
  components: {
    ArrowDownload20Regular,
    CheckmarkCircle20Regular,
    Delete20Regular,
    Edit20Regular
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const { t } = useI18n();
    const notifications = useNotification();
    const store = createLocalInputMappingProfileStore();

    const profiles = ref<InputMappingProfileSummary[]>([]);
    const searchKeyword = ref('');
    const pageIndex = ref(1);
    const pageSize = ref(10);
    const activeProfileId = ref('');
    const isInputMappingEnabled = ref(false);
    const fileInput = ref<HTMLInputElement | null>(null);
    const editingProfile = ref<InputMappingProfile | null>(null);
    const isProfileInfoDialogVisible = ref(false);
    const profileInfoForm = ref({
      name: '',
      author: '',
      packageName: '',
      description: ''
    });

    const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase());
    const isSelectionControlsVisible = computed(() => route.query.mode !== 'manage');
    const routeAppPackageName = computed(() => typeof route.query.appPackage === 'string' ? route.query.appPackage.trim() : '');
    const routeInputMappingTabKey = computed(() => typeof route.query.inputMappingTabKey === 'string' ? route.query.inputMappingTabKey.trim() : '');

    const syncActiveStateFromTab = () => {
      const tabState = getInputMappingTabState(routeInputMappingTabKey.value);
      activeProfileId.value = tabState.activeProfileId;
      isInputMappingEnabled.value = tabState.enabled;
    };

    const filteredProfiles = computed(() => {
      const keyword = normalizedKeyword.value;
      if (!keyword) {
        return profiles.value;
      }

      return profiles.value.filter((profile) => [
        profile.name,
        profile.author,
        profile.description,
        profile.packageName
      ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    });

    const totalPages = computed(() => Math.max(1, Math.ceil(filteredProfiles.value.length / pageSize.value)));

    const pagedProfiles = computed(() => {
      const start = (pageIndex.value - 1) * pageSize.value;
      return filteredProfiles.value.slice(start, start + pageSize.value);
    });

    const refreshProfiles = async () => {
      syncActiveStateFromTab();
      profiles.value = await store.list();
      if (activeProfileId.value && !profiles.value.some((profile) => profile.id === activeProfileId.value)) {
        activeProfileId.value = '';
        persistActiveState();
      }
      if (pageIndex.value > totalPages.value) {
        pageIndex.value = totalPages.value;
      }
    };

    const persistActiveState = () => {
      setInputMappingTabState(routeInputMappingTabKey.value, {
        activeProfileId: activeProfileId.value,
        enabled: isInputMappingEnabled.value
      });
    };

    const setActiveProfile = (profileId: string) => {
      activeProfileId.value = profileId;
      isInputMappingEnabled.value = true;
      persistActiveState();
      notifications.show({
        type: 'success',
        title: t('InputMapping.ActiveProfileChanged', '已选择按键映射方案'),
        message: profiles.value.find((profile) => profile.id === profileId)?.name || profileId
      });
    };

    const disableInputMapping = () => {
      isInputMappingEnabled.value = false;
      persistActiveState();
    };

    const createSampleProfile = async () => {
      await router.push({
        name: 'screencast',
        query: {
          ...(routeAppPackageName.value ? { appPackage: routeAppPackageName.value } : {}),
          ...(routeInputMappingTabKey.value ? { inputMappingTabKey: routeInputMappingTabKey.value } : {}),
          inputMappingNew: '1',
          inputMappingEdit: '1'
        }
      });
    };

    const openProfileInfoDialog = async (profile: InputMappingProfileSummary) => {
      const fullProfile = await store.get(profile.id);
      if (!fullProfile) {
        notifications.show({
          type: 'error',
          title: t('InputMapping.ProfileNotFound', '方案不存在'),
          message: profile.name
        });
        await refreshProfiles();
        return;
      }

      editingProfile.value = fullProfile;
      profileInfoForm.value = {
        name: fullProfile.name,
        author: fullProfile.author || '',
        packageName: fullProfile.target.packageName || '',
        description: fullProfile.description || ''
      };
      isProfileInfoDialogVisible.value = true;
    };

    const closeProfileInfoDialog = () => {
      isProfileInfoDialogVisible.value = false;
      editingProfile.value = null;
    };

    const saveProfileInfo = async () => {
      const profile = editingProfile.value;
      if (!profile) {
        return;
      }

      const name = profileInfoForm.value.name.trim();
      if (!name) {
        notifications.show({
          type: 'warning',
          title: t('InputMapping.ProfileNameRequired', '请填写方案名称'),
          message: t('InputMapping.ProfileNameRequiredMessage', '保存按键映射方案前需要填写名称。')
        });
        return;
      }

      const nextProfile: InputMappingProfile = {
        ...profile,
        name,
        author: profileInfoForm.value.author.trim(),
        description: profileInfoForm.value.description.trim(),
        target: {
          ...profile.target,
          packageName: profileInfoForm.value.packageName.trim()
        }
      };

      await store.save(nextProfile);
      closeProfileInfoDialog();
      await refreshProfiles();
      notifications.show({
        type: 'success',
        title: t('InputMapping.SaveSuccess', '保存成功'),
        message: nextProfile.name
      });
    };

    const deleteProfile = async (profile: InputMappingProfileSummary) => {
      const confirmed = window.confirm(t(
        'InputMapping.DeleteProfileConfirm',
        '确定删除按键映射方案“{0}”吗？此操作不可恢复。',
        profile.name
      ));
      if (!confirmed) {
        return;
      }

      await store.remove(profile.id);
      if (activeProfileId.value === profile.id) {
        activeProfileId.value = '';
        isInputMappingEnabled.value = false;
        persistActiveState();
      }
      await refreshProfiles();
      notifications.show({
        type: 'success',
        title: t('InputMapping.DeleteSuccess', '删除成功'),
        message: profile.name
      });
    };

    const exportProfile = async (profile: InputMappingProfileSummary) => {
      const fullProfile = await store.get(profile.id);
      if (!fullProfile) return;

      const content = store.export(fullProfile);
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sanitizeDownloadFileName(`${fullProfile.name || fullProfile.id}.json`, `${fullProfile.id}.json`);
      link.click();
      URL.revokeObjectURL(url);
    };

    const triggerImport = () => {
      fileInput.value?.click();
    };

    const handleImportFile = async (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      const file = input?.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const profile = await store.import(content);
        await store.save(profile);
        await refreshProfiles();
        if (isSelectionControlsVisible.value) {
          setActiveProfile(profile.id);
        }
        notifications.show({
          type: 'success',
          title: t('InputMapping.ImportSuccess', '导入成功'),
          message: profile.name
        });
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('InputMapping.ImportFailed', '导入失败'),
          message: error instanceof Error ? error.message : t('InputMapping.ImportFailed', '导入失败')
        });
      } finally {
        if (input) {
          input.value = '';
        }
      }
    };

    const formatUpdatedAt = (profile: InputMappingProfileSummary) => {
      if (!profile.updatedAt) return '-';
      return new Date(profile.updatedAt).toLocaleString();
    };

    const updateSearchKeyword = (event: Event) => {
      searchKeyword.value = (event.target as HTMLInputElement | null)?.value ?? '';
      pageIndex.value = 1;
    };

    const updatePageSize = (event: Event) => {
      const nextPageSize = Number((event.target as HTMLSelectElement | null)?.value || 10);
      pageSize.value = PAGE_SIZE_OPTIONS.includes(nextPageSize) ? nextPageSize : 10;
      pageIndex.value = 1;
    };

    const previousPage = () => {
      pageIndex.value = Math.max(1, pageIndex.value - 1);
    };

    const nextPage = () => {
      pageIndex.value = Math.min(totalPages.value, pageIndex.value + 1);
    };

    const goBack = () => {
      if (route.query.mode === 'manage') {
        void router.push({ name: 'settings' });
        return;
      }

      void router.push({
        name: 'screencast',
        query: {
          ...(routeAppPackageName.value ? { appPackage: routeAppPackageName.value } : {}),
          ...(routeInputMappingTabKey.value ? { inputMappingTabKey: routeInputMappingTabKey.value } : {})
        }
      });
    };

    onMounted(refreshProfiles);
    onActivated(refreshProfiles);

    return {
      t,
      profiles,
      searchKeyword,
      pageIndex,
      pageSize,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      activeProfileId,
      isInputMappingEnabled,
      isSelectionControlsVisible,
      isProfileInfoDialogVisible,
      profileInfoForm,
      fileInput,
      filteredProfiles,
      pagedProfiles,
      totalPages,
      goBack,
      setActiveProfile,
      disableInputMapping,
      createSampleProfile,
      openProfileInfoDialog,
      closeProfileInfoDialog,
      saveProfileInfo,
      deleteProfile,
      exportProfile,
      triggerImport,
      handleImportFile,
      formatUpdatedAt,
      updateSearchKeyword,
      updatePageSize,
      previousPage,
      nextPage
    };
  }
});
