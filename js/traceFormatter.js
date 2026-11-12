const program = `public class stringAndCharTest {
    public static void main(String[] args) {
        String s  = "abc";
        char c = 'a';
        System.out.println(s+c);
    }
}`;

const fs = require("node:fs");
const path = require("path");
const trace_data = path.join(__dirname, "../trace_data/stringAndCharTest.json");

//整形したトレース
let formattedTrace = {
    code: [],
    states: [] //stateが入る
};

//プログラムの現在状態
let state = {
    location: null,
    frames: [],
    heap: {},
    stdout: "",
    exception: null
};

main();
function main(){
    const rawTrace = getTrace(trace_data);
    //console.log(rawTrace);
    formattedTrace = getFormattedTrace(rawTrace);
    splitProgram(program);

    //整形したトレースをjsonに変換して保存
    downloadJsonFile(formattedTrace);}

//jsonファイルを読み込む関数
function getTrace(trace_data){
    const jsonText = fs.readFileSync(trace_data, "utf-8");
    const rawTrace = JSON.parse(jsonText);
    //console.log(rawTrace);
    return rawTrace;
}

//トレースを可視化しやすく整形する関数
function getFormattedTrace(rawTrace){
    //各フレームに固有のID
    let nextFrameId = 0;

    //rawTraceのeventを一つずつ読む
    for(let i=0; i<rawTrace.events.length; i++){
        const event = rawTrace.events[i];
       
        //不要なイベントを除外
        if(
            event.kind === "vmStart" ||
            event.kind === "vmEnd" ||
            event.kind === "classPrepare" 
        ){
            continue;
        }

        //methodEntryの場合の処理
        if(event.kind === "methodEntry"){
            state.location = {
                className: event.className,
                methodName: event.methodName,
                line: event.line
            };  

            const frame = {
                frameId: nextFrameId++,
                depth: event.data.frameDepth,
                className: event.className,
                methodName: event.methodName,
                locals: formatLocals(event.data.locals),
                retval: null
            };
            state.frames.push(frame);

            applyHeapChanges(state.heap, event.data.heapChanges);
        }

        //stepの時の処理
        if(event.kind === "step"){
            state.location = {
                className: event.className,
                methodName: event.methodName,
                line: event.line
            };

            //スタックの一番上にあるものが現在実行中のメソッド
            const currentFrame = state.frames[state.frames.length-1];

            //localsを更新
            currentFrame.locals = formatLocals(event.data.locals);

            //ヒープを更新
            applyHeapChanges(state.heap, event.data.heapChanges);

            //標準出力を追加
            if("stdoutDelta" in event.data){
               state.stdout += event.data.stdoutDelta;
            }
        }

        //methodExcitの場合の処理
        if(event.kind === "methodExit"){
            state.location = {
                className: event.className,
                methodName: event.methodName,
                line: event.line
            };  

            const currentFrame = state.frames[state.frames.length-1];
            currentFrame.retval = formatValue(event.data.retval);
            //console.log(formatValue(event.data.retval));
            //console.log(currentFrame);
            formattedTrace.states.push({
                eventIndex: i,
                eventKind: event.kind,
                ...removeMainArgs(structuredClone(state))
            });
            //メソッドから出る時，スタックから削除
            state.frames.pop();

            continue;
        }
        
        //exceptionの場合の処理
        if(event.kind === "exception"){
            state.location = {
                className: event.className,
                methodName: event.methodName,
                line: event.line
            };

            state.exception = {
                exceptionType: event.data.exceptionType,
                message: event.data.message
            };
        }
        //console.log(event);
        formattedTrace.states.push({
            eventIndex: formattedTrace.states.length,
            eventKind: event.kind,
            ...removeMainArgs(structuredClone(state))//行ごとに整形したもののコピーをして入れる
        })
    }


    //整形したトレースを返す
    return formattedTrace;
}

//トレースの中で表記揺れのある値を統一する関数
function formatValue(value){
    //nullの表記を統一
    if(value === null || value === "null"){
        return{
            kind: "null"
        };
    }

    //参照型の表記を統一
    // {type: "Node", id: 55}
    if(
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "type" in value &&
        "id" in value
    ){
        return{
            kind: "reference",
            type: value.type,
            id: value.id
        }
    }

    //"Node#55"
    if(typeof value === "string"){
        const match = value.match(/^(.+)#(\d+)$/);
        if(match !== null){
            return{
                kind: "reference",
                type: match[1],
                id: Number(match[2])
            };
        }
    }

    //<void value>
    if(value === "<void value>"){
        return{
            kind: "void"
        };
    }

    //どれにも該当しない
    return{
        kind:"value",
        value:value
    };
}

//locals全体を整形しやすくする関数
function formatLocals(locals){
    const result = {};

    for(const[name, value] of Object.entries(locals)){
        result[name] = formatValue(value);
    }

    return result;
}


//値の変更に関する情報から，現在の状態を作る関数
function applyHeapChanges(heap, heapChanges){
    for(const change of heapChanges){
        //オブジェクトを作成したときの状態を保存
        const fields = {};
        if(
            change.kind === "heapCreated" &&
            change.objectKind === "object"
        ){

            for(const [name, value] of Object.entries(change.fields)){
                fields[name] = formatValue(value);
                //console.log(fields);
            }

            heap[change.id] = {
                id: change.id,
                type: change.type,
                objectKind: "object",
                fields: fields
            };
        }

        

        //配列を作成した時の情報を保存
        if(
            change.kind === "heapCreated" &&
            change.objectKind === "array"
        ){
            heap[change.id] = {
                id: change.id,
                type: change.type,
                objectKind: "array",
                elements: change.elements.map(formatValue)//配列の中身を整形してから渡す
            }
        }

        //フィールドの変更を保存
        if(change.kind === "fieldChanged"){
            heap[change.id].fields[change.field] = formatValue(change.newValue);
        }

        //配列の要素の変更を保存
        if(change.kind === "arrayElementChanged"){
            heap[change.id].elements[change.index] = formatValue(change.newValue);
        }
    }
}

//mainのargsとその参照先オブジェクトを除外する関数
function removeMainArgs(state){
    for (const frame of state.frames) {
        // mainメソッド以外は対象外
        if (frame.methodName !== "main") {
            continue;
        }

        const args = frame.locals.args;

        // argsが参照しているオブジェクトを削除
        delete state.heap[args.id];

        // ローカル変数argsを削除
        delete frame.locals.args;
    }

    return state;
}


//Javaプログラムを行ごとに分割した配列にしてトレースに入れる関数
function splitProgram(program){
    const lines = program.split("\n");
    //console.log(lines);
    formattedTrace.code = lines;
}

//jsonをファイルとしてダウンロードし，formatted_trace_dataに保存する関数
function downloadJsonFile(formattedTrace){
    const path = require("path");
    
    const targetFolder = "../formatted_trace_data";
    const jsonFileName = formattedTrace.states[1].location.className + "_formatted.json";
    const filePath = path.join(__dirname, targetFolder, jsonFileName);

    fs.writeFileSync(filePath, JSON.stringify(formattedTrace, null, 2), "utf-8");
    console.log(`${jsonFileName} の保存が完了しました`);
}









