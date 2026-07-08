import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import FluentDropdown from './FluentDropdown.vue';

const options = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'completed', label: '已完成' }
];

describe('FluentDropdown', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the selected label and emits selected values', async () => {
    const wrapper = mount(FluentDropdown, {
      props: {
        modelValue: 'all',
        options
      }
    });

    expect(wrapper.find('.fluent-dropdown__trigger').text()).toContain('全部');

    await wrapper.find('.fluent-dropdown__trigger').trigger('click');
    await wrapper.findAll('.fluent-dropdown__option')[1].trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['running']);
    expect(wrapper.find('.fluent-dropdown__menu').exists()).toBe(false);
  });

  it('filters searchable options by label', async () => {
    const wrapper = mount(FluentDropdown, {
      props: {
        modelValue: 'all',
        options,
        searchable: true,
        searchPlaceholder: '搜索'
      }
    });

    await wrapper.find('.fluent-dropdown__trigger').trigger('click');
    await wrapper.find('input[type="search"]').setValue('运行');

    const visibleOptions = wrapper.findAll('.fluent-dropdown__option').map((option) => option.text());
    expect(visibleOptions).toEqual(['运行中']);
  });

  it('closes when clicking outside', async () => {
    const wrapper = mount(FluentDropdown, {
      attachTo: document.body,
      props: {
        modelValue: 'all',
        options
      }
    });

    await wrapper.find('.fluent-dropdown__trigger').trigger('click');
    expect(wrapper.find('.fluent-dropdown__menu').exists()).toBe(true);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.fluent-dropdown__menu').exists()).toBe(false);
    wrapper.unmount();
  });
});
