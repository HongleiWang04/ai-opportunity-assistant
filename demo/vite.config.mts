import {cpSync,copyFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

const project = resolve(import.meta.dirname,"..");
const output = resolve(project,"outputs/github-pages-demo");

export default defineConfig({
  root:import.meta.dirname,
  base:"./",
  publicDir:false,
  plugins:[react(),{
    name:"copy-demo-data",
    closeBundle(){
      cpSync(resolve(project,"public/avatars"),resolve(output,"avatars"),{
        recursive:true,filter:source=>!source.endsWith(".jpg"),
      });
      for(const file of ["sql-wasm.js","sql-wasm.wasm","LICENSE"]){
        copyFileSync(resolve(import.meta.dirname,"vendor",file),resolve(output,"assets",file));
      }
      copyFileSync(resolve(project,"data/opportunities_demo.sqlite"),resolve(output,"assets/opportunities_demo.sqlite"));
      writeFileSync(resolve(output,".nojekyll"),"");
    },
  }],
  build:{outDir:output,emptyOutDir:true},
});
