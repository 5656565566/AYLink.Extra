import { computed, defineComponent, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storageKeys } from '../core/storage/keys';
import { useI18n } from '../composables/useI18n';
import { useNotification } from '../services/notification';
import {
  createSampleInputMappingProfile,
  type InputMappingProfileSummary
} from '../features/inputMapping/inputMappingSchema';
import { createLocalInputMappingProfileStore } from '../features/inputMapping/inputMappingProfileStore';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default defineComponent({
  name: 'InputMappingProfilesView',
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const notifications = useNotification();
    const store = createLocalInputMappingProfileStore();

    const profiles = ref<InputMappingProfileSummary[]>([]);
    const searchKeyword = ref('');
    const pageIndex = ref(1);
    const pageSize = ref(10);
    const activeProfileId = ref(localStorage.getItem(storageKeys.inputMapping.activeProfileId) || '');
    const isInputMappingEnabled = ref(localStorage.getItem(storageKeys.inputMapping.enabled) === 'true');
    const fileInput = ref<HTMLInputElement | null>(null);

    const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase());

    const filteredProfiles = computed(() => {
      const keyword = normalizedKeyword.value;
      if (!keyword) {
        return profiles.value;
      }

      return profiles.value.filter((profile) => [
        profile.name,
        profile.description,
        profile.packageName,
        String(profile.bindingCount)
      ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    });

    const totalPages = computed(() => Math.max(1, Math.ceil(filteredProfiles.value.length / pageSize.value)));

    const pagedProfiles = computed(() => {
      const start = (pageIndex.value - 1) * pageSize.value;
      return filteredProfiles.value.slice(start, start + pageSize.value);
    });

    const refreshProfiles = async () => {
      profiles.value = await store.list();
      if (activeProfileId.value && !profiles.value.some((profile) => profile.id === activeProfileId.value)) {
        activeProfileId.value = '';
        localStorage.removeItem(storageKeys.inputMapping.activeProfileId);
      }
      if (pageIndex.value > totalPages.value) {
        pageIndex.value = totalPages.value;
      }
    };

    const persistActiveState = () => {
      if (activeProfileId.value) {
        localStorage.setItem(storageKeys.inputMapping.activeProfileId, activeProfileId.value);
      } else {
        localStorage.removeItem(storageKeys.inputMapping.activeProfileId);
      }
      localStorage.setItem(storageKeys.inputMapping.enabled, String(isInputMappingEnabled.value));
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
      const profile = createSampleInputMappingProfile();
      await store.save(profile);
      activeProfileId.value = profile.id;
      isInputMappingEnabled.value = true;
      persistActiveState();
      await router.push({
        name: 'screencast',
        query: {
          inputMappingProfileId: profile.id,
          inputMappingEdit: '1'
        }
      });
    };

    const editProfileInScreencast = (profile: InputMappingProfileSummary) => {
      setActiveProfile(profile.id);
      void router.push({
        name: 'screencast',
        query: {
          inputMappingProfileId: profile.id,
          inputMappingEdit: '1'
        }
      });
    };

    const deleteProfile = async (profile: InputMappingProfileSummary) => {
      await store.remove(profile.id);
      if (activeProfileId.value === profile.id) {
        activeProfileId.value = '';
        isInputMappingEnabled.value = false;
        persistActiveState();
      }
      await refreshProfiles();
    };

    const exportProfile = async (profile: InputMappingProfileSummary) => {
      const fullProfile = await store.get(profile.id);
      if (!fullProfile) return;

      const content = store.export(fullProfile);
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fullProfile.name || fullProfile.id}.aylink-input-map.json`;
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
        setActiveProfile(profile.id);
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
      router.back();
    };

    onMounted(refreshProfiles);

    return {
      t,
      profiles,
      searchKeyword,
      pageIndex,
      pageSize,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      activeProfileId,
      isInputMappingEnabled,
      fileInput,
      filteredProfiles,
      pagedProfiles,
      totalPages,
      goBack,
      setActiveProfile,
      disableInputMapping,
      createSampleProfile,
      editProfileInScreencast,
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
