<!--
  计数器组件（C23 seed）。
  <script setup> 含两组逻辑：
  - 计数器逻辑（count ref + double computed + increment/decrement 方法）—— 应提取到 useCounter()
  - 模态框逻辑（isVisible ref + open/close）—— 保留在 .vue（不提取）

  任务：把计数器逻辑提取到 workspace/useCounter.js，.vue 通过 import 引用。
-->
<script setup>
import { ref, computed } from 'vue'

// === 计数器逻辑（提取目标）===
const count = ref(0)
const double = computed(() => count.value * 2)
function increment() {
  count.value++
}
function decrement() {
  count.value--
}

// === 模态框逻辑（保留，不提取）===
const isVisible = ref(false)
function openModal() {
  isVisible.value = true
}
function closeModal() {
  isVisible.value = false
}

defineExpose({ count, double, increment, decrement, isVisible, openModal, closeModal })
</script>

<template>
  <div>
    <p>{{ count }} (×2 = {{ double }})</p>
    <button @click="increment">+</button>
    <button @click="decrement">-</button>
    <button @click="openModal">Open</button>
    <div v-if="isVisible">Modal content<button @click="closeModal">×</button></div>
  </div>
</template>
