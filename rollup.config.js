import typescript from "rollup-plugin-typescript2"
import commonjs from "rollup-plugin-commonjs"

let cjs = commonjs()
let result = []

function config(module, format) {
  let [_, base, file] = /^(.+?)\/src\/(.*?)\.ts/.exec(module)
  return {
    input: `./${module}`,
    external: id => !/^\.?\//.test(id),
    output: {
      format,
      file: `./${base}/dist/${file}.${format == "cjs" ? "js" : "esm"}`,
      sourcemap: true,
      externalLiveBindings: false
    },
    plugins: [typescript({
      tsconfig: "./tsconfig.base.json",
      tsconfigOverride: {
        compilerOptions: {
          target: format == "esm" ? "es6" : "es5",
          declarationDir: `./${base}/dist`,
          declarationMap: true
        },
        include: [`./${base}/src/*.ts`]
      },
      useTsconfigDeclarationDir: true
    }), cjs]
  }
}

let esm = !process.env.NO_ESM

for (let module of ["text/src/index.ts",
                    "extension/src/extension.ts",
                    "state/src/index.ts",
                    "rangeset/src/rangeset.ts",
                    "history/src/history.ts",
                    "view/src/index.ts",
                    "gutter/src/index.ts",
                    "commands/src/commands.ts",
                    "special-chars/src/special-chars.ts",
                    "syntax/src/index.ts",
                    "matchbrackets/src/matchbrackets.ts",
                    "keymap/src/keymap.ts",
                    "multiple-selections/src/multiple-selections.ts",
                    "theme/src/index.ts",
                    "stream-syntax/src/stream-syntax.ts",
                    "lang-javascript/src/javascript.ts",
                    "lang-css/src/css.ts",
                    "lang-html/src/html.ts"]) {
  result.push(config(module, "cjs"))
  if (esm) result.push(config(module, "esm"))
}


if (process.env.DEMO) result.push({
  input: `./demo/demo.ts`,
  external: id => !/^\.?\//.test(id),
  output: {
    format: "cjs",
    file: "./demo/demo.js",
    sourcemap: true,
  },
  plugins: [typescript({
    tsconfigOverride: {
      compilerOptions: {declaration: false},
      include: [`./demo/*.ts`]
    }
  }), cjs]
})


export default result