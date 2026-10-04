import {defineConfig} from 'vite';
export default defineConfig({base:'./',server:{port:5178,strictPort:true},build:{chunkSizeWarningLimit:900}});
