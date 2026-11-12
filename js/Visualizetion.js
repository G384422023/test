//const traceFilePath = "../formatted_trace_data/MethodTest2_formatted.json";
//const traceFilePath = "../formatted_trace_data/Test1_formatted.json";
//const traceFilePath = "../formatted_trace_data/Test4____formatted.json";
//const traceFilePath = "../formatted_trace_data/ExceptionTest_formatted.json";
const traceFilePath = "./formatted_trace_data/MainH_formatted.json";
//const traceFilePath = "../formatted_trace_data/saiki_formatted.json";
//const traceFilePath = "../formatted_trace_data/ifTest_formatted.json";
//const traceFilePath = "../formatted_trace_data/stringAndCharTest_formatted.json";

//問題設定
const questionSettings = [
    {
        id:"q2",//問題ID
        startStep: 22,//問題の開始ステップ番号
        endStep: 23,//問題の終了ステップ番号
        text: "15行目実行後の状態を図示せよ",//問題文
        howToAnswer:["arrow","value","structure"],//解答方法
        feedback: ""//不正解の時に表示するフィードバック
        //正誤判定の表示をするか
        //何ステップ目から可視化を開始するか
        //ログを収集するか
    },
]

//トレースを返す関数
async function loadTrace(filePath){
     const response = await fetch(filePath);
     const trace = await response.json();
     //console.log(trace);
     return trace;
}


//プログラムの可視化

class ExecutionVisualizer{

    //コンストラクタ
    constructor(containerId, trace, questions){
        //可視化を表示するHTML要素のIDを保存
        this.containerId = containerId;
        //Javaプログラムのコードを保存
        this.curInputCode = trace.code;
        //各ステップの状態を保存
        this.curTrace = trace.states;

        //可視化対象の最初のトレース位置
        this.firstInstr = 0;
        //可視化対象の最後のトレース位置
        this.lastInstr = this.curTrace.length - 1;
        //現在のステップを可視化対象の最初の位置に設定
        this.curInstr = this.firstInstr;
        //次に実行する行
        this.curLineNumber = null;
        //直前に実行した行
        this.prevLineNumber = null;
        //前回ハイライトした次に実行する行
        this.highlightedCurLine = null;
        //前回ハイライトした直前に実行した行
        this.highlightedPrevLine = null; 

        //JSAVのコード表示ようインスタンスを作成
        this.av = new JSAV(containerId, {animationMode: "none"});
        //JSAVで作成したコード表示を後で更新できるように保存する
        this.codeView = null;

        //スタック・ヒープ・参照矢印を表示するJSAVインスタンスを作成
        this.dataAv = new JSAV("jsav_data_container", {
            animationMode: "none"
        });

        //現在描画されているフレームを保存する
        this.renderedFrames = new Map();

        //現在描画されている変数を保存する
        this.renderedVariables = new Map();

        //現在描画されているオブジェクトを保存する
        this.renderedHeapObjects = new Map();

        //オブジェクトIDと描画されているフィールドを保存する
        this.renderedFields = new Map();

        //現在のステップで描画したJSAVオブジェクトを保存する
        this.renderedDataStructures = [];

        //参照関係を一時的に保存する配列
        this.referenceRelations = [];

        //各ステップにおけるオブジェクトの配置情報を保存する
        this.curTraceLayouts = [];


        //出題する問題を入れる
        this.questions = questions;

        //現在解答中の問題を保存
        this.activeQuestion = null;

        //現在編集中の可視化図の状態
        this.answerState = null;

        //解答状態の履歴
        this.answerStates = [];

        //現在参照している履歴のインデックス
        this.answerStateIndex = -1;

        //現在選択されている解答操作
        this.editMode = null;

        //画面上の要素と矢印の接続先情報を対応させる
        this.arrowEndpoints = new Map();

        //現在選択されている矢印の始点
        this.selectedArrowSource = null;
    }

    //現在選択されている編集モードのボタンを強調する
    updateEditModeButtons(){

        //ボタンIDと編集モードの対応
        const buttons = {
            editArrowButton: "arrow",
            editValueButton: "value",
            deleteButton: "deleteStructure"
        };

        //各ボタンの選択状態を更新する
        for(const [id, mode] of Object.entries(buttons)){

            const button = document.getElementById(id);

            //選択中のボタンを強調する
            button.classList.toggle(
                "selected-answer-mode",
                this.editMode === mode
            );
        }
    }

    //解答状態にあるフレーム，インスタンスを追加先の選択肢にする
    updateAddVariableOptions(){
        const select = document.getElementById("addVariableTarget");
        select.replaceChildren();

        //既存のスタックフレーム
        for(const frame of this.answerState.frames ?? []){
            select.add(new Option(
                `${frame.className}.${frame.methodName} (depth ${frame.depth})`,
                `frame:${frame.frameId}`
            ));
        }

        //既存のクラスインスタンス
        for(const object of Object.values(this.answerState.heap ?? {})){
            if(object.objectKind === "object"){
                select.add(new Option(
                    `${object.type} #${object.id}`,
                    `object:${object.id}`
                ));
            }
        }

        //新しいフレームを作る選択肢
        select.add(new Option("新しいフレーム", "new"));
        this.updateAddVariableFields();
    }

    //新規フレームを選んだときだけメソッド名の入力欄を表示する
    updateAddVariableFields(){
        const isNew = document.getElementById("addVariableTarget").value === "new";
        document.getElementById("addVariableMethodRow").hidden = !isNew;
        document.getElementById("addVariableMethod").required = isNew;
    }

    //配列を選んだときだけ要素数の入力欄を表示する
    updateAddObjectFields(){
        const isArray = document.getElementById("addObjectKind").value === "array";
        document.getElementById("addObjectLengthRow").hidden = !isArray;
        document.getElementById("addObjectLength").required = isArray;
    }

    //問題の終了ステップに対応するレイアウトを取得
    getQuestionLayout(){
        return this.curTraceLayouts[this.stepToIndex(this.activeQuestion.endStep)];
    }

    //画面上のステップ番号をトレース配列のインデックスに変換
    stepToIndex(step){
        return step - 1;
    }

    //学習者の解答を確認する
    checkAnswer(){
        //問題の解答中でなければ処理しない
        if(this.activeQuestion === null || this.answerState === null){
            return;
        }

        //正解となるトレースの状態を取得
        const correctState = this.curTrace[this.stepToIndex(this.activeQuestion.endStep)];

        //現在の解答と正解状態を比較する
        const isCorrect = this.compareAnswerStates(
            this.answerState,
            correctState
        );

        //正解の場合
        if(isCorrect){
            //結果を表示
            alert("正解です");

            //問題を終了して通常の可視化へ戻る
            this.finishQuestion();
        }
        //不正解の場合
        else{
            //表示するメッセージ
            let message = "不正解です";

            //問題設定にフィードバックがあれば追加する
            if(this.activeQuestion.feedback){
                message += "\n\n" + this.activeQuestion.feedback;
            }
            //結果とフィードバックを表示
            alert(message);

            //問題を終了せず，解答を継続する
        }
    }

    //解答状態と正解トレースを照合する
    compareAnswerStates(answerState, correctState){
        if(!answerState || !correctState){
            return false;
        }

        //誤った矢印が存在すれば不正解
        if((answerState.invalidArrows ?? []).length > 0){
            return false;
        }

        //解答と正解のヒープ
        const answerHeap = answerState.heap ?? {};
        const correctHeap = correctState.heap ?? {};

        //すべてのオブジェクトIDを取得
        const answerIds = Object.keys(answerHeap);
        const correctIds = Object.keys(correctHeap);

        //オブジェクトの個数が異なれば不正解
        if(answerIds.length !== correctIds.length){
            return false;
        }

        //解答側のIDと正解側のIDの対応関係
        const objectMap = new Map();

        //正解側のIDから解答側のIDへの逆対応
        const reverseMap = new Map();

        //変数名やフィールド名が一致するか確認する
        const sameKeys = (a, b) => {

            const keysA = Object.keys(a ?? {}).sort();
            const keysB = Object.keys(b ?? {}).sort();

            return keysA.length === keysB.length &&
                keysA.every((key, index) => key === keysB[index]);
        };

        //変数・配列要素・フィールドなどの値を比較する
        const compareValue = (a, b, map, reverse) => {

            //両方とも値が存在しない場合
            if(a == null || b == null){
                return a == null && b == null;
            }

            //値の種類が異なる場合
            if(a.kind !== b.kind){
                return false;
            }

            //通常の値の場合
            if(a.kind === "value"){
                return String(a.value) === String(b.value);
            }

            //参照値の場合
            if(a.kind === "reference"){

                //参照先のオブジェクトを比較する
                return compareObject(a.id, b.id, map, reverse);
            }

            return ["null", "void"].includes(a.kind);
        };

        //オブジェクトの構造と参照関係を比較する
        const compareObject = (answerId, correctId, map, reverse) => {

            answerId = String(answerId);
            correctId = String(correctId);

            //比較対象のオブジェクトを取得
            const a = answerHeap[answerId];
            const b = correctHeap[correctId];

            if(!a || !b){
                return false;
            }

            //すでに対応付けられている場合
            if(map.has(answerId)){
                return map.get(answerId) === correctId;
            }

            //正解側のオブジェクトが別の解答オブジェクトに対応済み
            if(reverse.has(correctId)){
                return false;
            }

            //オブジェクトの種類と型を比較する
            if(a.objectKind !== b.objectKind || a.type !== b.type){
                return false;
            }

            //配列の場合，長さを比較する
            if(a.objectKind === "array"){

                if(
                    (a.elements ?? []).length !==
                    (b.elements ?? []).length
                ){
                    return false;
                }
            }
            //クラスインスタンスの場合，フィールド名を比較する
            else if(a.objectKind === "object"){

                if(!sameKeys(a.fields, b.fields)){
                    return false;
                }
            }
            else{
                return false;
            }

            //オブジェクト同士を対応付ける
            map.set(answerId, correctId);
            reverse.set(correctId, answerId);

            //配列の各要素を比較する
            if(a.objectKind === "array"){

                for(let i = 0; i < a.elements.length; i++){

                    if(!compareValue(
                        a.elements[i],
                        b.elements[i],
                        map,
                        reverse
                    )){
                        return false;
                    }
                }
            }

            //クラスインスタンスの各フィールドを比較する
            else{

                for(const name of Object.keys(a.fields ?? {})){

                    if(!compareValue(
                        a.fields[name],
                        b.fields[name],
                        map,
                        reverse
                    )){
                        return false;
                    }
                }
            }

            return true;
        };

        //スタックから参照されていないオブジェクトも比較する
        const matchRemainingObjects = (map, reverse) => {

            //まだ対応付けられていない解答側のオブジェクト
            const answerId = answerIds.find(id => !map.has(id));

            //すべて対応付けられていれば正解
            if(answerId === undefined){
                return true;
            }

            //対応候補のオブジェクトを順番に試す
            for(const correctId of correctIds){

                //すでに別のオブジェクトと対応していれば除外
                if(reverse.has(correctId)){
                    continue;
                }

                //候補ごとに対応関係をコピーする
                const nextMap = new Map(map);
                const nextReverse = new Map(reverse);

                //構造が一致する候補を探す
                if(
                    compareObject(
                        answerId,
                        correctId,
                        nextMap,
                        nextReverse
                    ) &&
                    matchRemainingObjects(nextMap, nextReverse)
                ){
                    return true;
                }
            }

            return false;
        };

        //フレームをdepth順に並べる
        const answerFrames = [...(answerState.frames ?? [])]
            .sort((a, b) => a.depth - b.depth);

        const correctFrames = [...(correctState.frames ?? [])]
            .sort((a, b) => a.depth - b.depth);

        //フレーム数を比較する
        if(answerFrames.length !== correctFrames.length){
            return false;
        }

        //フレームを順番に比較する
        for(let i = 0; i < answerFrames.length; i++){

            const a = answerFrames[i];
            const b = correctFrames[i];

            //フレームの所属・深さ・メソッド名を比較
            if(
                a.depth !== b.depth ||
                a.className !== b.className ||
                a.methodName !== b.methodName
            ){
                return false;
            }

            //ローカル変数名を比較
            if(!sameKeys(a.locals, b.locals)){
                return false;
            }

            //各ローカル変数の値を比較
            for(const name of Object.keys(a.locals ?? {})){

                if(!compareValue(
                    a.locals[name],
                    b.locals[name],
                    objectMap,
                    reverseMap
                )){
                    return false;
                }
            }

            //戻り値を比較
            if(!compareValue(
                a.retval,
                b.retval,
                objectMap,
                reverseMap
            )){
                return false;
            }
        }

        //残っているオブジェクトも含めて比較する
        return matchRemainingObjects(objectMap, reverseMap);
    }

    //現在の解答状態を履歴に保存する
    saveAnswerState(){
        if(this.activeQuestion === null || this.answerState === null){
            return;
        }

        //現在の履歴に保存されている状態
        const currentHistory = this.answerStates[this.answerStateIndex];

        //解答状態が変化していなければ保存しない
        if(JSON.stringify(this.answerState) === JSON.stringify(currentHistory)){
            return;
        }

        //途中まで戻ってから新しく編集した場合，現在位置より後の履歴を削除する
        this.answerStates = this.answerStates.slice(
            0,
            this.answerStateIndex + 1
        );

        //現在の解答状態をコピーして履歴に追加
        this.answerStates.push(structuredClone(this.answerState));

        //現在位置を追加した履歴へ進める
        this.answerStateIndex = this.answerStates.length - 1;

        //履歴操作ボタンの状態を更新
        this.updateAnswerHistoryButtons();
    }

    //指定されたインデックスの解答状態を復元する
    restoreAnswerState(index){
        //問題の解答中でなければ処理しない
        if(this.activeQuestion === null){
            return;
        }

        //履歴の範囲外なら処理しない
        if(index < 0 || index >= this.answerStates.length){
            return;
        }

        //現在位置を更新
        this.answerStateIndex = index;

        //履歴から解答状態をコピーして復元
        this.answerState = structuredClone(
            this.answerStates[this.answerStateIndex]
        );

        //選択中の矢印の始点を解除
        this.selectedArrowSource = null;

        //復元した状態を再描画
        this.renderDataStructures(
            this.answerState,
            this.getQuestionLayout()
        );

        //履歴操作ボタンの状態を更新
        this.updateAnswerHistoryButtons();
    }

    //解答状態を1つ前に戻す
    undoAnswer(){
        this.restoreAnswerState(this.answerStateIndex - 1);
    }
    //解答開始直後の状態に戻す
    resetAnswer(){
        this.restoreAnswerState(0);
    }

    //履歴操作ボタンの有効・無効を更新する
    updateAnswerHistoryButtons(){

        //現在の履歴位置が最初なら戻れない
        const disabled = (
            this.activeQuestion === null ||
            this.answerStateIndex <= 0
        );

        document.getElementById("undoAnswerButton").disabled = disabled;
        document.getElementById("resetAnswerButton").disabled = disabled;
    }

    //削除対象のマウス操作を登録する
    registerDeleteTarget(elements, target){
        //削除モード以外では登録しない
        if(
            this.activeQuestion === null ||
            this.editMode !== "deleteStructure"
            ){
            return;
        }

        //削除操作を受け付ける画面上の要素
        const targets = $(elements);

        //クリックできることを示す
        targets.css("cursor", "pointer");

        //マウスが重なったとき
        targets.on("mouseenter", () => {

            //対象を赤色で強調する
            targets.addClass("structure-delete-hover");
        });

        //マウスが離れたとき
        targets.on("mouseleave", () => {

            //赤色の強調を解除する
            targets.removeClass("structure-delete-hover");
        });

        //クリックされたとき
        targets.on("click", event => {

            //他のクリック処理へ伝えない
            event.stopPropagation();

            //対応するデータを削除する
            this.deleteStructure(target);
        });
    }

    //指定された変数・フィールド・オブジェクトを削除する
    deleteStructure(target){

        //削除モード以外では処理しない
        if(
            this.activeQuestion === null ||
            this.editMode !== "deleteStructure"
        ){
            return;
        }

        //現在の解答状態
        const state = this.answerState;

        if(!state){
            return;
        }

        //ローカル変数・戻り値を削除する場合
        if(target.kind === "variable"){

            //所属するフレームを取得
            const frame = state.frames.find(
                frame => frame.frameId === target.frameId
            );

            if(!frame){
                return;
            }

            //戻り値の場合
            if(target.isReturn){

                if(frame.retval == null){
                    return;
                }

                frame.retval = null;
            }

            //ローカル変数の場合
            else{

                if(!Object.hasOwn(frame.locals ?? {}, target.name)){
                    return;
                }

                delete frame.locals[target.name];
            }
        }

        //フレーム全体を削除する場合
        else if(target.kind === "frame"){

            //指定されたフレームが存在するか確認する
            const frame = state.frames.find(
                frame => frame.frameId === target.frameId
            );

            if(!frame){
                return;
            }

            //指定されたフレームを削除する
            state.frames = state.frames.filter(
                frame => frame.frameId !== target.frameId
            );
        }

        //クラスインスタンスのフィールドを削除する場合
        else if(target.kind === "field"){

            //所属するオブジェクトを取得
            const object = state.heap[String(target.objectId)];

            if(!Object.hasOwn(object?.fields ?? {}, target.fieldName)){
                return;
            }

            //フィールドを削除
            delete object.fields[target.fieldName];
        }

        //オブジェクトを削除する場合
        else if(target.kind === "object"){

            const objectId = String(target.objectId);

            //対象のオブジェクトが存在しなければ終了
            if(!Object.hasOwn(state.heap, objectId)){
                return;
            }

            //ヒープからオブジェクトを削除
            delete state.heap[objectId];

            //削除したオブジェクトへの参照を空欄に変更する
            const clearReference = value => {

                if(
                    value?.kind === "reference" &&
                    String(value.id) === objectId
                ){
                    return {kind: "empty"};
                }

                return value;
            };

            //スタックフレームの参照を確認
            for(const frame of state.frames){

                for(const [name, value] of Object.entries(frame.locals ?? {})){
                    frame.locals[name] = clearReference(value);
                }

                if(frame.retval != null){
                    frame.retval = clearReference(frame.retval);
                }
            }

            //残っているヒープ内の参照を確認
            for(const object of Object.values(state.heap)){

                //配列の場合
                if(object.objectKind === "array"){

                    object.elements = object.elements.map(clearReference);
                }

                //クラスインスタンスの場合
                else if(object.objectKind === "object"){

                    for(const [name, value] of Object.entries(object.fields ?? {})){
                        object.fields[name] = clearReference(value);
                    }
                }
            }
        }

        //削除された要素に接続していた不正な矢印を取り除く
        const isDeletedEndpoint = endpoint => {

            if(!endpoint){
                return false;
            }

            //フレームを削除した場合
            if(target.kind === "frame"){
                return endpoint.kind === "variable" &&
                    endpoint.frameId === target.frameId;
            }

            //オブジェクトを削除した場合
            if(target.kind === "object"){
                return endpoint.objectId != null &&
                    String(endpoint.objectId) === String(target.objectId);
            }

            //フィールドを削除した場合
            if(target.kind === "field"){
                return endpoint.kind === "field" &&
                    String(endpoint.objectId) === String(target.objectId) &&
                    endpoint.fieldName === target.fieldName;
            }

            //変数を削除した場合
            if(target.kind === "variable"){
                return endpoint.kind === "variable" &&
                    endpoint.frameId === target.frameId &&
                    endpoint.name === target.name &&
                    Boolean(endpoint.isReturn) === Boolean(target.isReturn);
            }

            return false;
        };

        //始点または終点が削除対象の矢印を取り除く
        state.invalidArrows = (state.invalidArrows ?? []).filter(arrow => {
            return !isDeletedEndpoint(arrow.source) &&
                !isDeletedEndpoint(arrow.target);
        });

        //履歴に保存
        this.saveAnswerState();

        //削除後の可視化図を再描画
        this.renderDataStructures(
            state,
            this.getQuestionLayout()
        );
    }

    //解答状態から指定した要素の現在値を取得する
    getAnswerValue(source){
        if(!this.answerState){
            return undefined;
        }

        //スタックフレームの変数・戻り値
        if(source.kind === "variable"){
            const frame = this.answerState.frames.find(
                frame => frame.frameId === source.frameId
            );

            return source.isReturn
                ? frame?.retval
                : frame?.locals?.[source.name];
        }

        //配列要素
        if(source.kind === "arrayElement"){
            return this.answerState.heap[String(source.objectId)]
                ?.elements?.[source.index];
        }

        //クラスインスタンスのフィールド
        if(source.kind === "field"){
            return this.answerState.heap[String(source.objectId)]
                ?.fields?.[source.fieldName];
        }

        return undefined;
    }

    //解答状態の変数・配列要素・フィールドの値を更新する
    updateAnswerValue(source, newValue){
        if(!this.answerState){
            return false;
        }

        //スタックフレームの変数・戻り値
        if(source.kind === "variable"){
            const frame = this.answerState.frames.find(
                frame => frame.frameId === source.frameId
            );

            if(!frame){
                return false;
            }

            if(source.isReturn){
                frame.retval = newValue;
            }else{
                if(!Object.hasOwn(frame.locals ?? {}, source.name)){
                    return false;
                }
                frame.locals[source.name] = newValue;
            }
        }

        //配列要素
        else if(source.kind === "arrayElement"){
            const array = this.answerState.heap[String(source.objectId)];

            if(
                !array ||
                !Array.isArray(array.elements) ||
                !(source.index in array.elements)
            ){
                return false;
            }

            array.elements[source.index] = newValue;
        }

        //クラスインスタンスのフィールド
        else if(source.kind === "field"){
            const object = this.answerState.heap[String(source.objectId)];

            if(
                !object?.fields ||
                !Object.hasOwn(object.fields, source.fieldName)
            ){
                return false;
            }

            object.fields[source.fieldName] = newValue;
        }

        else{
            return false;
        }

        //値の変更に伴い，同じ始点の不正な矢印を削除する
        const sourceKey = JSON.stringify(source);

        this.answerState.invalidArrows =
            (this.answerState.invalidArrows ?? []).filter(
                arrow => JSON.stringify(arrow.source) !== sourceKey
            );

        return true;
    }

    //解答中のレイアウト計算
    getAnswerLayout(state){
        //現在の解答図に存在するオブジェクト
        const heap = state.heap ?? {};

        //オブジェクトIDと配置情報の対応
        const layout = new Map();

        //参照関係をたどり，横方向の深さを求める
        const visit = (id, depth, path = new Set()) => {

            id = String(id);
            const object = heap[id];

            //存在しないオブジェクトや循環参照は処理しない
            if(!object || path.has(id)){
                return;
            }

            //すでに計算した深さを取得
            const position = layout.get(id);

            //以前の深さ以上でなければ再計算しない
            if(position && position.depth >= depth){
                return;
            }

            //オブジェクトの横方向の深さを保存
            if(position){
                position.depth = depth;
            }else{
                layout.set(id, {depth: depth, y: 0});
            }

            path.add(id);

            //オブジェクトが持つ値を取得
            const values = object.objectKind === "array"
                ? object.elements ?? []
                : Object.values(object.fields ?? {});

            //参照先のオブジェクトを再帰的に処理
            for(const value of values){
                if(value?.kind === "reference"){
                    visit(value.id, depth + 1, path);
                }
            }

            path.delete(id);
        };

        //スタックから参照されているオブジェクトを調べる
        for(const frame of state.frames ?? []){

            for(const value of Object.values(frame.locals ?? {})){
                if(value?.kind === "reference"){
                    visit(value.id, 0);
                }
            }

            //戻り値が参照の場合
            if(frame.retval?.kind === "reference"){
                visit(frame.retval.id, 0);
            }
        }

        //スタックから参照されていないオブジェクトも配置する
        for(const id of Object.keys(heap)){
            visit(id, 0);
        }

        //新しく追加されたオブジェクトにも配置番号を割り当てる
        for(const id of Object.keys(heap)){
            if(!this.objectSlots.has(id)){
                this.objectSlots.set(id, this.objectSlots.size);
            }
        }

        const sortedLayout = [...layout].sort(
            (a, b) => this.objectSlots.get(a[0]) -this.objectSlots.get(b[0])
        );

        //縦方向の配置を計算
        let y = 60;

        for(const [id, position] of sortedLayout){

            //現在のオブジェクトのY座標を保存
            position.y = y;

            //オブジェクトの高さと余白を加える
            y += this.getHeapObjectHeight(heap[id]) + 20;
        }

        return layout;
    }

    //入力を元にオブジェクトを追加する
    addObject(input){
        //すべてのトレースから既存のオブジェクトIDを取得
        const ids = this.curTrace.flatMap(state => Object.keys(state.heap ?? {})).map(Number);

        //解答中に追加されたオブジェクトIDも取得
        ids.push(...Object.keys(this.answerState.heap ?? {}).map(Number));

        //使用されていない新しいオブジェクトIDを作成
        const id = Math.max(0, ...ids)+1;

        //追加するオブジェクト
        let heapObject;
        //配列の場合
        if(input.objectKind === "array"){
            heapObject = {
                id: id,
                type: input.type,
                objectKind: "array",
                //指定された要素数にする
                elements: Array.from({length: input.length},()=>({kind: "empty"}))
            };
        }
        //クラスインスタンスの場合
        else if(input.objectKind === "object"){
            heapObject = {
                id: id,
                type: input.type,
                objectKind: "object",
                fields: {}
            };
        }
        else{
            return;
        }

        //新しいオブジェクトをヒープに追加
        this.answerState.heap[String(id)] = heapObject;

        //編集した解答状態を履歴に保存
        this.saveAnswerState();

        //追加後の解答状態を再描画
        this.renderDataStructures(
            this.answerState, this.getQuestionLayout()
        );
    }

    //入力を元に変数を追加する
    addVariable(input){
        //スタックフレームに追加する場合
        if(input.destination === "frame"){
            //同じメソッド名のフレームを探す
            let frame = this.answerState.frames.find(frame => frame.depth === input.depth && frame.methodName === input.methodName);

            //フレームが存在しない場合
            if(!frame){
                //既存のフレームIDの最大値
                const maxFrameId = Math.max(
                    -1, ...this.answerState.frames.map(frame => frame.frameId)
                );
                //既存のフレームの最大depth
                const maxDepth = Math.max(
                    0, ...this.answerState.frames.map(frame => frame.depth)
                );

                //新しいフレームを作成
                frame = {
                    frameId: maxFrameId+1,
                    depth: maxDepth+1,
                    className: this.answerState.location.className,
                    methodName: input.methodName,
                    locals: {},
                    retval: null
                };
                //スタックの末尾に追加
                this.answerState.frames.push(frame);
            }

            //同じ名前の変数が存在する場合
            if(Object.hasOwn(frame.locals, input.name)){
                alert("同じ名前の変数が存在します");
                return;
            }

            //変数値を空の状態で追加
            frame.locals[input.name] = {kind: "empty"};
        }

        //クラスインスタンスに追加する場合
        else if(input.destination === "object"){
            //追加先のインスタンスを取得
            const object = this.answerState.heap[input.objectId];
            if(!object || object.objectKind !== "object"){
                return;
            }

            //フィールドが存在しない場合に初期化
            object.fields ??={};

            //同じ名前のフィールドが存在する場合
            if(Object.hasOwn(object.fields, input.name)){
                alert("同じ名前の変数が存在します");
                return;
            }

            //フィールドを空欄で追加
            object.fields[input.name] = {kind: "empty"};
        }

        //編集した解答状態を履歴に保存
        this.saveAnswerState();

        //追加後の可視化図を描画
        this.renderDataStructures(
            this.answerState, this.getQuestionLayout()
        );
        //追加できたか入力フォームに知らせる
        return true;
    }

    //追加する変数の情報を入力する
    getAddVariableInput(){
        if(!this.activeQuestion?.howToAnswer?.includes("structure")){
            return null;
        }

        //フォームから変数名と追加先を取得する
        const name = document.getElementById("addVariableName").value.trim();
        const target = document.getElementById("addVariableTarget").value;
        if(name === ""){
            return null;
        }

        //新しいフレームに変数を追加する場合
        if(target === "new"){
            const methodName = document.getElementById("addVariableMethod").value.trim();
            return methodName === "" ? null : {
                name, destination: "frame", methodName, depth: null
            };
        }

        //既存のフレームに変数を追加する場合
        if(target.startsWith("frame:")){
            const frameId = target.slice("frame:".length);
            const frame = this.answerState.frames.find(
                frame => String(frame.frameId) === frameId
            );
            return frame ? {
                name, destination: "frame",
                methodName: frame.methodName, depth: frame.depth
            } : null;
        }

        //既存のインスタンスにフィールドを追加する場合
        if(target.startsWith("object:")){
            const objectId = target.slice("object:".length);
            const object = this.answerState.heap[objectId];
            return object?.objectKind === "object" ? {
                name, destination: "object", objectId
            } : null;
        }

        return null;
    }

    //追加する配列，クラスインスタンスの情報を入力する
    getAddObjectInput(){
        if(!this.activeQuestion?.howToAnswer?.includes("structure")){
            return null;
        }

        //フォームからオブジェクトの種類と型名を取得する
        const objectKind = document.getElementById("addObjectKind").value;
        const type = document.getElementById("addObjectType").value.trim();
        if(type === ""){
            return null;
        }

        //クラスインスタンスの場合は型名だけ必要
        if(objectKind === "object"){
            return {objectKind, type};
        }

        //配列の場合は要素数も取得する
        if(objectKind === "array"){
            const lengthText = document.getElementById("addObjectLength").value;
            const length = Number(lengthText);
            if(lengthText.trim() === "" || length < 0 || !Number.isSafeInteger(length)){
                alert("lengthには0以上の整数を入力してください");
                return null;
            }
            return {objectKind, type, length};
        }

        return null;
    }

    //矢印の始点，終点として使用する要素を登録する
    registerArrowEndpoint(element, endpoint, jsavElement){
        //要素を識別するためのキーを作成
        const key = JSON.stringify(endpoint);

        //画面上の要素と識別情報を対応させる
        if(!this.arrowEndpoints.has(key)){
            this.arrowEndpoints.set(key,{
                jsavElement: jsavElement,
                element: $(element)
            });
        }

        //矢印モード以外ではクリック処理を追加しない
        if(
            this.activeQuestion === null ||
            this.editMode !== "arrow"
        ){
            return;
        }

        //操作できることをわかるようにする
        $(element).css("cursor", "crosshair");

        //終点にマウスを重ねたとき
        $(element).on("mouseenter", () => {

            //始点が選択されていなければ何もしない
            if(this.selectedArrowSource === null){
                return;
            }

            //始点自身は終点候補として強調しない
            if(JSON.stringify(this.selectedArrowSource) === key){
                return;
            }

            //配列要素は終点にできない
            if(endpoint.kind === "arrayElement"){
                return;
            }

            //終点を強調する
            $(element).addClass("arrow-target-hover");
        });

        //終点からマウスが離れたとき
        $(element).on("mouseleave", () => {

            //強調表示を解除する
            $(element).removeClass("arrow-target-hover");
        });

        //クリックされた要素を矢印操作へわたす
        $(element).on("click", event =>{
            event.stopPropagation();
            this.handleArrowClick(endpoint);
        });
    }

    //矢印モードで要素がクリックされた時の処理
    handleArrowClick(endpoint){
        //1回目のクリックなら始点として保存する
        if(this.selectedArrowSource === null){
            this.selectedArrowSource = endpoint;

            //選択した要素を強調する
            const key = JSON.stringify(endpoint);
            const selected = this.arrowEndpoints.get(key);
            selected.element.css(
                "outline", "2px solid #0051ff"
            );
            return;
        }

        //保存していた始点を取得する
        const source = this.selectedArrowSource;

        //配列要素を終点にできないようにする
        if(
            endpoint.kind === "arrayElement" &&
            JSON.stringify(source) !== JSON.stringify(endpoint)
        ){
            return;
        }

        //視点の選択状態を解除する
        this.selectedArrowSource = null;

        //始点と終点が同じ場合
        if(JSON.stringify(source) === JSON.stringify(endpoint)){
            //その始点から出ている矢印を削除する
            this.removeArrow(source);
        }else{
            //異なる要素なら矢印を追加する
            this.addArrow(source,endpoint);
        }
        //解答履歴に保存
        this.saveAnswerState();

        //変更後の解答状態を再描画する
        this.renderDataStructures(this.answerState, this.getQuestionLayout());
    }

    //矢印を削除する
    removeArrow(source){

        const sourceKey = JSON.stringify(source);

        //始点が参照値を持っている場合
        if(this.getAnswerValue(source)?.kind === "reference"){

            //参照値を空欄に変更して矢印を削除
            this.updateAnswerValue(source, {kind: "empty"});
        }
        else{
            //参照値がない場合も不正な矢印を削除
            this.answerState.invalidArrows =
                this.answerState.invalidArrows.filter(
                    arrow => JSON.stringify(arrow.source) !== sourceKey
                );
        }
    }

    //指定した視点と終点の間に矢印を追加する
    addArrow(source, target){

        //始点から出ている既存の矢印を削除
        this.removeArrow(source);

        //参照値を持つことができる要素か確認
        const canHoldValue = [
            "variable", "arrayElement", "field"
        ].includes(source.kind);

        //参照関係として成立する場合
        if(target.kind === "object" && canHoldValue){

            //参照先のオブジェクトを取得する
            const targetObject =
                this.answerState.heap[String(target.objectId)];

            if(!targetObject){
                return;
            }

            //新しい参照値を作成する
            const newValue = {
                kind: "reference",
                type: targetObject.type,
                id: targetObject.id
            };

            //解答状態の参照値を更新する
            this.updateAnswerValue(source, newValue);
        }
        else{
            if(canHoldValue){
                this.updateAnswerValue(source, {kind: "empty"});
            }
            //間違った矢印
            this.answerState.invalidArrows.push({
                source: structuredClone(source),
                target: structuredClone(target)
            });
        }
    }

    //解答操作のモードを変更する
    setEditMode(mode){
        //問題出題中でなければ操作できない
        if(this.activeQuestion === null){
            return;
        }

        //教師が許可していない操作は選択できない
        //structureが許可されているとき削除操作をできるようにする
        const requiredAnswer = mode === "deleteStructure"?"structure":mode;
        if(!this.activeQuestion.howToAnswer.includes(requiredAnswer)){
            return;
        }
        

        //現在の操作モードを保存
        this.editMode = mode;

        //ボタンを強調
        this.updateEditModeButtons();

        //操作モードを切り替えたら矢印の始点選択を解除
        this.selectedArrowSource = null;

        //選択されたモードに対応するように再描画
        this.renderDataStructures(
            this.answerState, this.getQuestionLayout()
        );
    }

    //JSAVで表示した値をクリックして編集できるようにする
    attachValueEditor(element, value, source){
        //値の変更モード以外では編集できない
        if(
            this.activeQuestion === null ||
            this.editMode !== "value"
        ){
            return;
        }

        //編集可能であることを示す
        element.css("cursor", "text");

        //値をクリックしたときの処理
        element.on("click", event => {

            event.stopPropagation();

            //すでに入力中なら何もしない
            if(element.find("input").length > 0){
                return;
            }

            //現在の値を取得
            let oldText = "";

            if(value.kind === "value"){
                oldText = String(value.value);
            }
            else if(value.kind === "null"){
                oldText = "null";
            }

            //テキストボックスを作成
            const input = $("<input>", {
                type: "text"
            });

            input.val(oldText);

            //テキストボックスの表示設定
            input.css({
                width: "100%",
                height: "100%",
                margin: 0,
                padding: "0 2px",
                "box-sizing": "border-box",
                "font-size": "13px"
            });

            //値の表示をテキストボックスに置き換える
            element.empty().append(input);

            //入力の確定処理が重複しないようにする
            let finished = false;

            //入力を終了する処理
            const finish = (save) => {

                if(finished){
                    return;
                }

                finished = true;

                //入力内容を保存する場合
                if(save){

                    const text = String(input.val());
                    let newValue;

                    //空欄
                    if(text === ""){
                        newValue = {kind: "empty"};
                    }
                    //null
                    else if(text === "null"){
                        newValue = {kind: "null"};
                    }
                    //通常の値
                    else{
                        newValue = {
                            kind: "value",
                            value: text
                        };
                    }

                    if(this.updateAnswerValue(source, newValue)){
                        //値の変更が成功すれば履歴に保存
                        this.saveAnswerState();
                    }
                }

                //解答用の可視化図を再描画
                this.renderDataStructures(
                    this.answerState,
                    this.getQuestionLayout()
                );
            };

            //キーボード操作
            input.on("keydown", event => {

                //Enterキーで確定
                if(event.key === "Enter"){
                    event.preventDefault();
                    finish(true);
                }

                //Escapeキーでキャンセル
                else if(event.key === "Escape"){
                    event.preventDefault();
                    finish(false);
                }
            });

            //入力欄から離れた場合も確定
            input.on("blur", () => {
                finish(true);
            });

            //テキストボックスにフォーカスする
            input.trigger("focus").trigger("select");

        });
    }

    //解答用可視化図の初期状態を作る
    createAnswerState(question){
        //答え合わせを行うステップの状態
        const correctState = this.curTrace[this.stepToIndex(question.endStep)];
        //問題出題直前の状態
        const beforeState = this.curTrace[this.stepToIndex(question.startStep)];

        //正解状態をコピーする
        const answerState = structuredClone(correctState);


        //変数，オブジェクトの追加を解答方法に含む場合
        if(question.howToAnswer?.includes("structure")){
            this.restoreStartStructure(
                answerState, beforeState
            );
        }

        //矢印の追加を解答方法に含む場合
        if(question.howToAnswer?.includes("arrow")){

            //参照関係を出題直前の状態にする
            this.restoreStartReferences(
                answerState,
                beforeState
            );
        }

        //値の変更が解答対象の場合
        if(question.howToAnswer?.includes("value")){
            this.restoreStartValues(
                answerState, beforeState
            );
        }

        //誤った参照矢印を保存
        answerState.invalidArrows = [];
        
        //解答用可視化図の初期状態を返す
        return answerState;
    }

    //基本型の値を出題直前の状態にする
    restoreStartValues(answerState, beforeState){
        //スタックフレームの値
        for(const frame of answerState.frames ?? []){
            //出題直前の対応するフレームを探す
            const beforeFrame = (beforeState.frames ?? []).find(
                f =>(
                    f.depth === frame.depth &&
                    f.className === frame.className &&
                    f.methodName === frame.methodName
                )
            );

            //ローカル変数の値を処理
            for(const [name, value] of Object.entries(frame.locals ?? {})){
                const beforeValue = beforeFrame?.locals?.[name];

                frame.locals[name] = this.getInitialPrimitive(
                    value, beforeValue
                );
            }

            //戻り値を処理
            if(frame.retval != null){
                frame.retval = this.getInitialPrimitive(
                    frame.retval, beforeFrame?.retval
                );
            }

            //ヒープ内の値
            for(const [objectId, heapObject] of Object.entries(answerState.heap ?? {})){
                //出題直前の同じオブジェクト
                const beforeObject = beforeState.heap?.[objectId];

                //配列の場合
                if(Array.isArray(heapObject.elements)){
                    heapObject.elements = heapObject.elements.map(
                        (value, index) => {
                            const beforeValue = beforeObject?.elements?.[index];

                            return this.getInitialPrimitive(
                                value, beforeValue
                            );
                        }
                    )
                }

                //クラスインスタンスの場合
                if(heapObject.fields){
                    for(const [name, value] of Object.entries(heapObject.fields)){
                        const beforeValue = beforeObject?.fields?.[name];

                        heapObject.fields[name] = this.getInitialPrimitive(
                            value, beforeValue
                        );
                    }
                }
            }
                    
        }
    }

    //解答用の初期状態に表示する基本型の値を取得
    getInitialPrimitive(correctValue, beforeValue){
        //正解状態が基本型の値またはnullでなければ変更しない
        if(
            correctValue?.kind !== "value" &&
            correctValue?.kind !== "null"
        ){
            return correctValue;
        }

        //出題前に値が存在しない場合は空欄にする
        if(beforeValue === undefined){
            return {kind: "empty"};
        }

        //出題前がvalue,null,emptyの場合
        if(
            beforeValue.kind === "value" ||
            beforeValue.kind === "null" ||
            beforeValue.kind === "empty" 
        ){
            return structuredClone(beforeValue);
        }

        return correctValue;
    }

    //スタックフレーム，変数，オブジェクトの構造を出題直前の状態にする
    restoreStartStructure(answerState, beforeState){
        //スタックフレームとローカル変数
        answerState.frames = structuredClone(beforeState.frames ??[]);

        //オブジェクトと要素，フィールド変数
        answerState.heap = structuredClone(beforeState.heap ??{});
    }
    //解答対象の参照関係を出題直前の状態に戻す
    restoreStartReferences(answerState, beforeState){
        //スタックフレームの参照
        for(const frame of answerState.frames ?? []){

            //出題直前の対応するフレームを取得する
            const beforeFrame = (beforeState.frames ?? []).find(
                f =>
                    f.depth === frame.depth &&
                    f.className === frame.className &&
                    f.methodName === frame.methodName
            );

            //各変数の参照を処理する
            for(const [name, value] of Object.entries(frame.locals ?? {})){

                const beforeValue = beforeFrame?.locals?.[name];

                frame.locals[name] = this.getInitialReference(
                    value,
                    beforeValue
                );
            }

            //戻り値の参照も処理する
            if(frame.retval != null){

                frame.retval = this.getInitialReference(
                    frame.retval,
                    beforeFrame?.retval
                );
            }
        }

        //ヒープの参照
        for(const [objectId, heapObject] of Object.entries(answerState.heap ?? {})){

            //出題直前の同じオブジェクトを取得する
            const beforeObject = beforeState.heap?.[objectId];

            //配列要素の参照
            if(Array.isArray(heapObject.elements)){

                heapObject.elements = heapObject.elements.map(
                    (value, index) => {

                        const beforeValue = beforeObject?.elements?.[index];

                        return this.getInitialReference(
                            value,
                            beforeValue
                        );
                    }
                );
            }

            //フィールドの参照
            if(heapObject.fields){

                for(const [name, value] of Object.entries(heapObject.fields)){

                    const beforeValue = beforeObject?.fields?.[name];

                    heapObject.fields[name] = this.getInitialReference(
                        value,
                        beforeValue
                    );
                }
            }
        }
    }

    //初期状態で表示する参照値を取得する
    getInitialReference(correctValue, beforeValue){
        //参照値か確認
        const isReference = (
            correctValue?.kind === "reference" ||
            beforeValue?.kind === "reference"
        );

        //参照値でなければ正解状態をそのまま使用
        if(!isReference){
            return correctValue;
        }
        //出題前に値が存在しない場合はnullにする
        if(beforeValue === undefined){
            return {kind: "null"};
        }

        //参照値は出題直前の状態を使用する
        return structuredClone(beforeValue);
    }

    //問題の開始ステップか調べる
    findQuestionAfterCurrentStep(){

        const currentStep = this.curInstr + 1;

        return this.questions.find(
            q => q.startStep === currentStep
        ) ?? null;
    }

    //問題の開始
    startQuestion(question){
        //現在の問題を保存
        this.activeQuestion = question;

        //問題開始時は編集操作を選択していない状態にする
        this.editMode = null;

        //フォームをとじる
        document.getElementById("addVariableMenu").open = false;
        document.getElementById("addObjectMenu").open = false;

        //矢印の始点選択を初期化する
        this.selectedArrowSource = null;

        //矢印の追加，削除が許可されている場合だけボタンを表示
        document.getElementById("editArrowButton").hidden = !question.howToAnswer?.includes("arrow");

        //値の変更が許可されている場合だけボタンを表示
        document.getElementById("editValueButton").hidden = !question.howToAnswer?.includes("value");

        //追加が許可されている場合に３つのボタンを表示
        if(question.howToAnswer.includes("structure")){
            document.getElementById("addVariableButton").hidden = false;
            document.getElementById("addObjectButton").hidden = false;
            document.getElementById("deleteButton").hidden = false;
        }

        //解答用の初期状態を作成する
        this.answerState = this.createAnswerState(question);

        //解答履歴を初期化する
        this.answerStates = [
            structuredClone(this.answerState)
        ];

        //現在位置を初期状態にする
        this.answerStateIndex = 0;

        //履歴操作ボタンの状態を更新
        this.updateAnswerHistoryButtons();

        //正解ステップの配置情報を取得する
        const layout = this.getQuestionLayout();

        //解答用の状態を描画する
        this.renderDataStructures(
            this.answerState, layout
        );

        //問題文を表示
        const text = document.getElementById("questionText");

        text.textContent = question.text ?? "";
        text.hidden = !question.text;

        //問題文，ボタン表示領域を表示
        document.getElementById("questionPanel").hidden = false;

        //ステップ移動を無効にする
        this.updateStepButtons();
        //現在が解答中であることをステップ表示に反映する
        this.updateStepCounter();
    }

    //ステップ移動ボタンの有効，無効切り替え
    updateStepButtons(){
        //問題出題中なら使用不可
        const disabled = this.activeQuestion !== null;

        //ステップ移動ボタンのhtmlのID
        const buttons = [
            "stepBackButton",
            "stepForwardButton",
            "stepBackFirstButton",
            "stepForwardLastButton"
        ]

        //全てのステップ移動ボタンに設定を適応
        for(const id of buttons){
            document.getElementById(id).disabled = disabled;
        }
    }

    //問題を終了して通常の可視化に戻る
    finishQuestion(){
        //問題出題中でなければ終了
        if(this.activeQuestion === null){
            return;
        }

        //答え合わせに指定されたステップの実行後の位置 
        const targetIndex = this.activeQuestion.endStep-1;

        //現在の問題を解除する
        this.activeQuestion = null;

        //編集モードを解除
        this.editMode = null;

        //矢印の選択状態を解除する
        this.selectedArrowSource = null;

        //解答用の状態と履歴を破棄する
        this.answerState = null;
        this.answerStates = [];
        this.answerStateIndex = -1;
        //履歴操作ボタンの状態を更新
        this.updateAnswerHistoryButtons();

        //問題表示領域を非表示にする
        document.getElementById("questionPanel").hidden = true;

        //答え合わせのステップに移動する
        this.curInstr = targetIndex;

        //通常の可視化図を表示する
        this.updateOutput();

        //ステップ移動を有効にする
        this.updateStepButtons();
    }

    //現在の問題をスキップする
    skipQuestion(){
        this.finishQuestion();
    }

    //可視化画面の最初の表示
    render(){
        //Framesの見出しをJSAVで表示する
        const stackHeader = this.dataAv.label("Frames",{
            left: 10,
            top: 0
        });

        //Objectsの見出しをJSAVで表示する
        const heapHeader = this.dataAv.label("Objects",{
            left: 380,
            top: 0
        });

        //見出しの位置ずれをなくす
        stackHeader.element.css("margin", 0);
        heapHeader.element.css("margin", 0);
        //各ステップのオブジェクト配置を事前に計算する
        this.precomputeCurTraceLayouts();

        //Javaプログラムを表示
        this.renderJavaCodeOutput();

        //現在のステップに対応する表示へ更新
        this.updateOutput();
    }
    
    //各ステップのオブジェクト配置を事前計算する
    precomputeCurTraceLayouts(){

        //オブジェクトIDと配置番号の対応を保持する
        const objectSlots = new Map(); //参照値 => {縦の配置，　横の配置}

        //解答用
        this.objectSlots = objectSlots;

        //各配置番号で必要となる最大の高さを保存する
        const slotHeights = [];

        //全ステップの配置情報を初期化する
        this.curTraceLayouts = [];

        //すべてのステップを順番に処理する
        for(const state of this.curTrace){

            const heap = state.heap ?? {};

            //前のステップのレイアウト
            const prevLayout = this.curTraceLayouts.at(-1) ?? new Map();

            //現在のステップのレイアウト
            const layout = new Map();

            //前のステップに存在したオブジェクトの配置を引き継ぐ
            for (const [id, position] of prevLayout){
                if(heap[id]){
                    layout.set(id, {...position})
                }
            }

            //同じオブジェクトを複数回処理しない，参照元が複数の場合に最大の深さを保存
            const visited = new Map();

            //参照関係を再起でたどる
            const visit = (id, depth, path=new Set()) =>{
                id = String(id);

                const heapObject = heap[id];

                //存在しないか処理ずみなら終了
                if(!heapObject || path.has(id)){
                    return;
                }

                //以前に探索したdepthを取得
                const prevDepth = visited.get(id);
                
                //以前のdepthより深くなければ終了
                if(prevDepth !== undefined && prevDepth >= depth){
                    return;
                }

                //より深いdepthを記録
                visited.set(id, depth);

                path.add(id);

                //初めて登場したオブジェクトに配置番号を割り当てる
                if(!objectSlots.has(id)){
                    objectSlots.set(id, objectSlots.size);
                }

                const slot = objectSlots.get(id);

                //オブジェクトに必要な高さを保存
                const height = this.getHeapObjectHeight(heapObject);

                slotHeights[slot] = Math.max(
                    slotHeights[slot] ?? 0,
                    height
                );

                //配置番号とインデントの深さを保存
                layout.set(id, {
                    slot: slot,
                    depth: depth
                });

                //オブジェクトが持つ値を取り出す
                let values = [];

                if(heapObject.objectKind === "array"){
                    values = heapObject.elements ?? [];
                }
                else if(heapObject.objectKind === "object"){
                    values = Object.values(heapObject.fields ?? {});
                }

                //参照値があれば参照先を再起的に処理
                for(const value of values){
                    if(value?.kind === "reference"){
                        visit(value.id, depth+1, path);
                    }
                }

                //終了したら経路から除外
                path.delete(id);
            };

            //スタックの変数から参照先を深さ０にする
            for(const frame of state.frames ?? []){
                for(const value of Object.values(frame.locals ?? {})){
                    if(value?.kind === "regerence"){
                        visit(value.id, 0);
                    }
                }

                //戻り値が参照型の場合
                    if(frame.retval?.kind === "reference"){
                        visit(frame.retval.id, 0);
                    }
            }

            //スタックから見つからなかったオブジェクトも入れる
            for(const id of Object.keys(heap)){
                visit(id, 0);
            }

            //1ステップのレイアウトを保存
            this.curTraceLayouts.push(layout);

        }//全ステップ調べ終わり

        //各配置番号の実際のY座標を保存する
        this.heapSlotY = [];

        //Objects領域の描画開始位置を設定する
        let currentY = 60;

        //配置番号ごとに重ならない描画位置を計算する
        for(let slot = 0; slot < slotHeights.length; slot++){

            //現在の配置番号のY座標を保存する
            this.heapSlotY[slot] = currentY;

            //オブジェクトの高さと余白を加えて次の位置を計算する
            currentY += slotHeights[slot] + 20;
        }

        //新しく追加するオブジェクトの配置開始位置
        this.nextHeapSlotY = currentY;

        //全ステップで最も深いdepthを取得する
        let maxDepth = 0;

        for(const layout of this.curTraceLayouts){
            for(const position of layout.values()){
                maxDepth = Math.max(maxDepth, position.depth);
            }
        }

        //ヒープの描画に必要な横幅を計算
        this.requiredCanvasWidth = Math.max(
            760,
            380 + maxDepth * 130 + 300 + 40
        );

        //JSAVの描画領域の幅を設定
        const canvas = document.querySelector(
        "#jsav_data_container .jsavcanvas"
        );

        canvas.style.width = `${this.requiredCanvasWidth}px`;
    }

    //JavaプログラムをJSAVのコード表示機能で表示
    renderJavaCodeOutput(){
        //trace.codeに保存されているコードを表示する
        this.codeView = this.av.code(
            this.curInputCode,{lineNumbers: true}
        );
    }

    //現在のステップに対応する画面表示に更新
    updateOutput(){
        //console.log(this.renderedFields);
        //現在のステップのStateを取得
        const curEntry = this.curTrace[this.curInstr];
        //コード上の実行位置を更新
        this.updateCodeOutput(curEntry);

        //現在のステップのオブジェクトの位置を取得する
        const curToplevelLayout = this.curTraceLayouts[this.curInstr];

        //現在のステップを可視化する
        this.renderDataStructures(curEntry, curToplevelLayout);

        //標準出力とエラーを表示
        this.renderStdout();
        this.renderError();
    }

    //現在のステップの状態を可視化する
    renderDataStructures(curEntry, curToplevelLayout){
        //解答中のレイアウト計算
        if(curEntry === this.answerState && this.activeQuestion?.howToAnswer?.includes("structure")){
            curToplevelLayout = this.getAnswerLayout(curEntry);
        }

        //前のステップの可視化を消去
        this.clearDataStructures();

        //オブジェクトの描画
        this.renderHeap(curEntry.heap, curToplevelLayout);

        //スタックフレームと変数の描画
        this.renderStackFrames(curEntry.frames)

        //参照矢印の描画

        //間違った矢印を登録する
        for(const arrow of curEntry.invalidArrows ?? []){
            //始点の描画情報を取得する
            const source = this.arrowEndpoints.get(
                JSON.stringify(arrow.source)
            );
            //終点の描画情報を取得する
            const target = this.arrowEndpoints.get(
                JSON.stringify(arrow.target)
            );

            //始点または終点が存在しなければ描画しない
            if(!source || !target){
                continue;
            }
            //参照描画処理に渡せる形式で登録
            this.referenceRelations.push({
                source: arrow.source,
                target: arrow.target,
                sourceLabel: source.jsavElement,
                targetElement: target.jsavElement,
                targetId: arrow.target.kind === "object" ? arrow.target.objectId : null
            });

            //変数が矢印の始点の場合は丸を表示する
            if(arrow.source.kind === "variable" ||
               arrow.source.kind === "field"
            ){
                source.element.text("●");
            }
        }
        this.renderReferences();

    }

    clearDataStructures(){
        //前回描画したJSAVオブジェクトを順番に非表示にする(後で削除するように変更する)
        for(const renderedObject of this.renderedDataStructures){
            //前回の描画を非表示にする
            renderedObject.hide();
        }

        //JSAVオブジェクトの保存先を空にする
        this.renderedDataStructures = [];
        //描画済みフレームの対応情報をリセットする
        this.renderedFrames.clear();
        //参照関係を削除する
        this.referenceRelations = [];
        //変数と表示要素の対応情報をリセット
        this.renderedVariables.clear();
        //オブジェクトの情報をリセットする
        this.renderedHeapObjects.clear();
        //フィールドと描画要素の対応をリセット
        this.renderedFields.clear();
        //オブジェクトと描画要素の対応を削除
        this.renderedHeapObjects.clear();
        //前回描画したクリック対象の情報を削除する
        this.arrowEndpoints.clear();

    }

    //参照関係を受けとり，矢印を描画する
    renderReferences(){
        //参照関係を１つずつ処理する
        for(const relation of this.referenceRelations){
            //矢印の終点を取得
            let targetElement = relation.targetElement;
            //通常の参照値の場合はIDから参照先を探す
            if(!targetElement){
                const targetObject = this.renderedHeapObjects.get(String(relation.targetId));

                targetElement = targetObject.array ?? targetObject.box;
            }

            //参照矢印を描画
            this.renderReference(
                relation.sourceLabel,
                targetElement,
                relation
            )
        }
    }

    //矢印を描画する
    renderReference(sourceElement, targetElement, relation){
        //参照元と参照先の位置を取得する
        const source = this.getJSAVElementBounds(sourceElement);
        const target = this.getJSAVElementBounds(targetElement);

        //1本の線を描画する内部関数
        const drawLine = (x1, y1, x2, y2, arrowEnd = false) => {

            //線の表示設定
            const options = {
                stroke: "#000000",
                "stroke-width": 2
            };

            //終点に矢印を付ける
            if(arrowEnd){
                options["arrow-end"] = "classic-wide-long";
            }

            //JSAVで線を描画する
            const line = this.dataAv.g.line(
                x1, y1, x2, y2, options
            );

            //次のステップで非表示にできるように保存する
            this.renderedDataStructures.push(line);
        };

        //ローカル変数からローカル変数への矢印か判定
        const isVariableToVariable =
            relation.source?.kind === "variable" &&
            relation.target?.kind === "variable" &&
            !relation.source.isReturn &&
            !relation.target.isReturn;

        //同じインスタンス内のフィールドへの矢印か判定
        const isSameObjectField =
            relation.target?.kind === "field" &&
            (
                relation.source?.kind === "field" ||
                relation.source?.kind === "object"
            ) &&
            String(relation.source.objectId) ===
            String(relation.target.objectId);

        //右側に迂回する矢印を描画する
        if(isVariableToVariable || isSameObjectField){

            //迂回するための右端の位置
            let rightX = Math.max(source.right, target.right);

            //ローカル変数同士の場合
            if(isVariableToVariable){

                //始点と終点が所属するフレームを調べる
                const frameIds = [
                    relation.source.frameId,
                    relation.target.frameId
                ];

                for(const frameId of frameIds){

                    const frameInfo = this.renderedFrames.get(frameId);

                    if(frameInfo?.box){

                        //フレームの外枠の右端を取得する
                        const bounds = this.getJSAVElementBounds(
                            frameInfo.box
                        );

                        rightX = Math.max(rightX, bounds.right);
                    }
                }
            }

            //同じインスタンス内のフィールドの場合
            if(isSameObjectField){

                //フィールドが所属するオブジェクトを取得する
                const objectInfo = this.renderedHeapObjects.get(
                    String(relation.target.objectId)
                );

                if(objectInfo?.box){

                    //インスタンスの外枠の右端を取得する
                    const bounds = this.getJSAVElementBounds(
                        objectInfo.box
                    );

                    rightX = Math.max(rightX, bounds.right);
                }
            }

            //外枠より30px右側を通る
            const outsideX = rightX + 30;

            //オブジェクト自体が始点なら外枠から開始する
            const startX = relation.source.kind === "object"
                ? source.right
                : source.centerX;

            //始点から右側の迂回位置まで水平線を描画
            drawLine(
                startX,
                source.centerY,
                outsideX,
                source.centerY
            );

            //終点と同じ高さまで縦線を描画
            drawLine(
                outsideX,
                source.centerY,
                outsideX,
                target.centerY
            );

            //右側から終点へ矢印を描画
            drawLine(
                outsideX,
                target.centerY,
                target.right,
                target.centerY,
                true
            );

            return;
        }
        //同じオブジェクト自身への参照かを判定する
        const isSelfReference =(
            relation.source?.kind === "field" ||
            relation.source?.kind === "arrayElement" ||
            relation.source?.kind === "object"
        )&&
        relation.targetId != null &&
        String(relation.source.objectId) === String(relation.targetId);
        //自分自身を参照する場合は、右側を迂回する矢印を描画
        if(isSelfReference){

            const outsideX = target.right + 30;
            const returnY = target.top + 20;

            //参照元からオブジェクトの右外側へ
            drawLine(
                source.centerX,
                source.centerY,
                outsideX,
                source.centerY
            );

            //オブジェクトの右側を縦方向に移動
            drawLine(
                outsideX,
                source.centerY,
                outsideX,
                returnY
            );

            //オブジェクト自身の右辺へ戻る
            drawLine(
                outsideX,
                returnY,
                target.right,
                returnY,
                true
            );

            return;
        }

        //矢印の始点
        let x1 = source.centerX;
        let y1 = source.centerY;

        //矢印の終点
        let x2, y2;

        //参照元が参照先の左側にある場合
        if(source.right <= target.left){

            x2 = target.left;
            y2 = target.centerY;

        //参照元が参照先の右側にある場合
        }else if(source.left >= target.right){

            x2 = target.right;
            y2 = target.centerY;

        //参照元が参照先の上側にある場合
        }else if(source.bottom <= target.top){

            x2 = target.centerX;
            y2 = target.top;

        //参照元が参照先の下側にある場合
        }else if(source.top >= target.bottom){


            x2 = target.centerX;
            y2 = target.bottom;

        //表示領域が重なっている場合
        }else{
            console.warn("参照元と参照先が重なっています", relation);
            return;
        }

        //オブジェクト自体が始点の場合
        if(relation.source?.kind === "object"){

            //オブジェクトの中心から矢印の終点への方向
            const dx = x2 - source.centerX;
            const dy = y2 - source.centerY;

            //外枠との交点を求める
            const scale = Math.max(
                Math.abs(dx) / (source.width / 2),
                Math.abs(dy) / (source.height / 2)
            );

            //矢印の始点をオブジェクトの外枠上に移動
            if(scale > 0){
                x1 = source.centerX + dx / scale;
                y1 = source.centerY + dy / scale;
            }
        }

        //参照元から参照先への矢印を描画する
        drawLine(x1, y1, x2, y2, true);

    //参照元から参照先への矢印を描画する
    drawLine(x1, y1, x2, y2, true);
}
    

    //JSAV要素の位置を共通の描画座標系で取得する
    getJSAVElementBounds(jsavElement){

        //JSAVの描画領域を取得
        const svg = document.querySelector("#jsav_data_container .jsavcanvas svg");

        //JSAV要素から実際のDOM要素を取得する
        const element = jsavElement?.element?.[0] ?? jsavElement?.rObj?.node ?? jsavElement?.rObj;

        //画面上での位置を取得する
        const svgRect = svg.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        //SVGの左上を原点とした座標に変換する
        const left = elementRect.left - svgRect.left;
        const top = elementRect.top - svgRect.top;
        const width = elementRect.width;
        const height = elementRect.height;

        //位置とサイズを返す
        return{
            left: left,
            top: top,
            right: left+width,
            bottom: top+height,
            centerX: left+width/2,
            centerY: top+height/2,
            width: width,
            height: height
        };
    }


    //現在のヒープに存在するオブジェクトを描画する
    renderHeap(heap, curToplevelLayout){
        //現在のヒープに含まれるオブジェクトを順番に処理する
        for(const [objectId, heapObject] of Object.entries(heap ?? {})){
            //レイアウトを取得
            const position = curToplevelLayout.get(objectId);

            const x = 380+position.depth*200;

            const y = position.y ?? this.heapSlotY[position.slot];

            //オブジェクトの種類に応じて処理を分ける
            this.renderCompoundObject(heapObject, x, y);

        }
    }

    //オブジェクトの種類に応じた関数を呼び出す
    renderCompoundObject(heapObject, x, y){

        //配列の場合
        if(heapObject.objectKind ==="array"){
            this.renderArray(heapObject, x, y);
        }
        //クラスインスタンスの場合
        else if(heapObject.objectKind === "object"){
            this.renderObject(heapObject, x, y);
        }
    }

    //配列を１つJSAVで描画する
    renderArray(heapObject, x, y){
        //配列の各要素を表示用の文字列に変換する
        const values = heapObject.elements.map((value, index) =>{
            //配列要素から誤った矢印が出ているかを確認
            const hasInvalidArrow = (
                this.activeQuestion !== null
                    ? this.answerState.invalidArrows ?? []
                    : []
            ).some(arrow => {
                return (arrow.source.kind === "arrayElement" &&
                    String(arrow.source.objectId) === String(heapObject.id) &&
                    arrow.source.index === index
                );
            });

            //通常の参照値，間違った矢印がある場合
            if(value.kind === "reference" || hasInvalidArrow){
                return "⚫︎";
            }

            //基本型の場合
            if(value.kind === "value"){
                return String(value.value);

            }
            if(value.kind === "null"){
                return "null";

            }
            if(value.kind === "void"){
                return "void";

            }
            return "";
        });

        //配列の型名とオブジェクトIDを表示
        const arrayLabel = this.dataAv.label(`${heapObject.type} #${heapObject.id}`,{
            left: x,
            top: y
        });
        arrayLabel.element.css("margin", 0);

        //JSAVのarrayを作成
        const jsavArray = this.dataAv.ds.array(values, {
            left: x,
            top: y+30,
            center: false,
            indexed: true
        });

        //描画した配列をラベルを保存
        this.renderedDataStructures.push(arrayLabel, jsavArray);

        //配列IDと描画情報を対応させる
        this.renderedHeapObjects.set(String(heapObject.id), {
            object: heapObject,
            array: jsavArray,
            label: arrayLabel,
            x: x,
            y: y
        });

        //配列オブジェクトそのものを表す情報
        const endpoint = {
            kind: "object",
            objectId: String(heapObject.id)
        };

        //配列の型名，IDのラベルをクリックできるようにする
        this.registerArrowEndpoint(
            arrayLabel.element, endpoint, jsavArray
        );

        //値が参照値の時，参照関係を保存
        heapObject.elements.forEach((value, index) =>{
            if(value.kind !== "reference"){
                return;
            }

            //参照元の要素を取得
            const sourceElement = jsavArray.index(index);

            //配列要素からオブジェクトへの参照関係を登録する
            this.referenceRelation(
                {
                    kind: "arrayElement",
                    objectId: heapObject.id,
                    index: index
                },
                value.id,
                sourceElement
            );
        });

        //配列の買う要素を編集できるようにする
        heapObject.elements.forEach((value, index) => {
            //JSAVで表示した配列要素の値の領域を取得
            const valueElement = jsavArray.element.find(".jsavindex").eq(index).find(".jsavvalue");

            //値を編集できるようにする
            this.attachValueEditor(
                valueElement,
                value,
                {
                    kind: "arrayElement",
                    objectId: String(heapObject.id),
                    index: index
                }
            );
        });

        //配列要素を矢印の始点，終点として登録する
        heapObject.elements.forEach((value, index) => {
            //配列要素のHTML要素を取得
            const element = jsavArray.element.find(".jsavindex").eq(index);

            //JSAVの配列要素オブジェクトを取得する
            const jsavIndex = jsavArray.index(index);

            //配列要素を識別する情報
            const endpoint = {
                kind: "arrayElement",
                objectId: String(heapObject.id),
                index: index
            };

            //クリックできるように登録する
            this.registerArrowEndpoint(
                element, endpoint, jsavIndex,
            );
        });

        //配列を削除できるようにする
        this.registerDeleteTarget(
            arrayLabel.element.add(jsavArray.element),
            endpoint
        );

    }

    //１つのクラスインスタンスとそのフィールドを描画
    renderObject(heapObject, x, y){
        //インスタンスの横幅
        const width = 200;
        //インスタンスに含まれるフィールドを取得
        const fields = Object.entries(heapObject.fields ?? {});

        //フィールドの数で高さを決定
        const height = this.getHeapObjectHeight(heapObject);

        //JSAVでインスタンスの外枠を描画
        const objectBox = this.dataAv.g.rect(
            x, y, width, height,0,{
                stroke: "#000000",
                "stroke-width": 2,
                fill:"none"
            }
        );
        //外枠の線だけがクリックを受け取り，内部の値はクリックを通す
        objectBox.rObj.node.style.pointerEvents = "stroke";

        //クラス名,オブジェクトID(後で消す)を表示するラベルを作成
        const objectLabel = this.dataAv.label(`${heapObject.type} #${heapObject.id}`,{
            left: x+10,
            top:y+8
        });
        //クリックできる範囲を広げる
        objectLabel.element.css({
            margin: 0,

            //オブジェクトの内側いっぱいに広げる
            width: `${width - 20}px`,
            height: "25px",

            //大きさにpaddingを含める
            "box-sizing": "border-box",

            //文字の表示位置
            padding: "2px 6px",
            "line-height": "21px"
        });

        //非表示にするために保存
        this.renderedDataStructures.push(objectBox, objectLabel);

        //オブジェクトIDと描画したインスタンスの情報を対応させる
        this.renderedHeapObjects.set(String(heapObject.id), {
            object: heapObject,
            box: objectBox,
            label: objectLabel,
            x: x,
            y: y,
            width: width,
            height: height
        });

        //各フィールドを描画
        fields.forEach(([fieldName, value], index)=>{
            //フィールドの縦位置の計算
            const fieldY = y + 35 + index *26;

            //フィールド名とその値を描画
            this.renderField(
                heapObject.id,
                fieldName,
                value,
                x+12,
                fieldY
            );
        }) 

        //クラスインスタンスそのものを表す情報
        const endpoint = {
            kind: "object",
            objectId: String(heapObject.id)
        };

        //オブジェクト名をクリックできるようにする
        this.registerArrowEndpoint(
            objectLabel.element,
            endpoint,
            objectBox
        );

        //オブジェクトの外枠もクリックできるようにする
        this.registerArrowEndpoint(
            $(objectBox.rObj.node),
            endpoint,
            objectBox
        );

        //クラスインスタンスを削除できるようにする
        this.registerDeleteTarget(
            objectLabel.element.add(objectBox.rObj.node),
            endpoint
        );
    }

    //オブジェクトの種類と内容から必要な高さを求める
    getHeapObjectHeight(heapObject){

        //配列の場合
        if(heapObject.objectKind === "array"){
            return 90;
        }

        //クラスインスタンスの場合
        if(heapObject.objectKind === "object"){
            //フィールドの数を取得
            const fieldCount = Object.keys(heapObject.fields ?? {}).length;

            //必要な高さを返す
            return Math.max(64, 36+fieldCount*26);
        }
        return 64;
    }

    //クラスインスタンス内の１つのフィールドを描画
    renderField(objectId, fieldName, value, x, y){
        //フィールド名のラベルを作成
        const nameLabel = this.dataAv.label(fieldName, {
            left: x,
            top: y
        });
        nameLabel.element.css("margin",0);
        
        //フィールドの値を表示するラベルを作成
        const valueLabel = this.dataAv.label("",{
            left: x+60,
            top: y
        });
        //フィールドの値を囲む枠と文字の設定
        valueLabel.element.css({
             margin: 0,
            padding: "0 4px",

            //箱の大きさ
            width: "82px",
            height: "22px",
            "box-sizing": "border-box",

            // 箱の枠と背景
            border: "1px solid #555555",
            "background-color": "#ffffff",

            // 値を箱の中央に表示する
            "text-align": "center",
            "line-height": "20px",

            // 長い値が箱からはみ出さないようにする
            "white-space": "nowrap",
            "overflow-x": "auto",
            "overflow-y": "hidden",
        });

        //削除できるようにラベルを保存
        this.renderedDataStructures.push(nameLabel, valueLabel);

        //フィールドがどのオブジェクトのものかを識別する
        const source = {
            kind: "field",
            objectId: objectId,
            fieldName: fieldName
        };

        //型によって値の描画を分ける
        this.renderByType(value, valueLabel, source);

        //フィールドを一意に識別するためのキーを作成する
        const fieldId = JSON.stringify([objectId, fieldName]);

        //フィールドの値と画面上のラベルを対応させる
        this.renderedFields.set(fieldId,{
            objectId: objectId,
            fieldName: fieldName,
            value: value,
            nameLabel: nameLabel,
            valueLabel: valueLabel
        });

        //フィールドの値を編集できるようにする
        this.attachValueEditor(
            valueLabel.element,
            value,
            {
                kind: "field",
                objectId: String(objectId),
                fieldName: fieldName
            }
        );

        //矢印操作でフィールドを識別する情報
        const endpoint = {
            kind: "field",
            objectId: String(objectId),
            fieldName: fieldName
        };

        //矢印操作の対象として登録
        this.registerArrowEndpoint(
            valueLabel.element, endpoint, valueLabel
        );

        //フィールド名と値を削除できるようにする
        this.registerDeleteTarget(
            nameLabel.element.add(valueLabel.element),
            endpoint
        );
    }

    //現在のスタックにあるフレームを全て描画する
    renderStackFrames(frames){
        //フレームをコピー
        const Frames = [...frames];
        
        //最初のフレームの描画位置を設定する
        let currentY = 40;
        //フレームを順番に描画する
        for(const frame of Frames){
            //フレーム１つを指定した位置に描画
            const frameHeight = this.renderStackFrame(
                frame,
                10,
                currentY
            );
            //次のフレームを現在のフレームの下へ配置する
            currentY += frameHeight + 20;
        }
    }

    //１つのスタックフレームの枠とメソッド名を描画する
    renderStackFrame(frame, x, y){
        //フレームの横幅
        const width = 220;

        //表示する変数と戻り値を取得
        const entries = this.getFrameEntries(frame);

        //必要な高さを確保
        const height = Math.max(64, 36+ entries.length * 26);

        //JSAVでスタックフレームの枠を描画する
        const frameBox = this.dataAv.g.rect(
            x, y, width, height,0,{
                stroke:"#000000",
                "stroke-width": 2,
                fill: "none"
        });
        //外枠の線だけがクリックを受け取り，内部の値はクリックを通す
        frameBox.rObj.node.style.pointerEvents = "stroke";

        //メソッド名を表示するためのJSAVラベルを作成する
        const frameLabel = this.dataAv.label(
            "",
            {
                left: x+1,
                top: y+8
        });

        //クラス名をメソッド名を文字列として表示する
        frameLabel.element.text(`${frame.methodName}: ${this.curTrace[this.curInstr].location.line}`);

        //位置ずれの調整
        frameLabel.element.css("margin", 0);

        //描画した枠とラベルを削除できるように保存
        this.renderedDataStructures.push(frameBox,frameLabel);

        //フレームのIDを取得する
        const frameId = frame.frameId;
        //フレームのIDから描画情報を取得できるようにする
        this.renderedFrames.set(frameId,{
            frame: frame,
            x: x,
            y: y,
            width: width,
            height: height,
            box: frameBox,
            label: frameLabel
        });

        //変数と戻り値を描画する
        entries.forEach((entry, i) =>{
            this.renderVariable(
                entry,
                x+12,
                y+35+i*26,
                frame.frameId,
                frame
            )
        })

        //フレームを削除できるようにする
        this.registerDeleteTarget(
            frameLabel.element.add(frameBox.rObj.node),
            {
                kind: "frame",
                frameId: frame.frameId
            }
        );

        //次の描画用に高さを返す
        return height;
    }

    renderVariable(entry, x, y, frameId, frame){
        //変数名のJSAVラベルを作成
        const nameLabel = this.dataAv.label("",{
            left: x,
            top: y
        });

        //変数名を入れる
        const displayName = entry.name;
        nameLabel.element.text(displayName);
        nameLabel.element.css("margin",0);

        //値を表示するラベルを作成
        const valueLabel = this.dataAv.label("",{
            left: x+105,
            top:y
        });

        //値を箱で囲む
        valueLabel.element.css({
            margin: 0,
            padding: "0 4px",

            //箱の大きさ
            width: "82px",
            height: "22px",
            "box-sizing": "border-box",

            // 箱の枠と背景
            border: "1px solid #555555",
            "background-color": "#ffffff",

            // 値を箱の中央に表示する
            "text-align": "center",
            "line-height": "20px",

            // 長い値が箱からはみ出さないようにする
            "white-space": "nowrap",
            "overflow-x": "auto",
            "overflow-y": "hidden",
        });

        //次のステップで削除できるように保存する
        this.renderedDataStructures.push(nameLabel, valueLabel);

        //値の種類に応じて処理を変える
        this.renderByType(entry.value, valueLabel,{
            frameId: frameId,
            variableName: entry.name,
            isReturn: entry.isReturn
        });

        //フレームID，種類，変数名をJSONにして後で使いやすくする
        const variableId = JSON.stringify([
            frameId,
            entry.isReturn ? "return" : "variable",
            entry.name
        ]);

        //画面に表示されている変数のIDと情報
        this.renderedVariables.set(variableId,{
            frameId: frameId,
            name: entry.name,
            isReturn: entry.isReturn,
            value: entry.value,
            nameLabel: nameLabel,
            valueLabel: valueLabel
        });

        //値を編集できるようにする
        this.attachValueEditor(
        valueLabel.element,
        entry.value,
        {
            kind: "variable",
            frameId: frame.frameId,
            frameDepth: frame.depth,
            name: entry.name,
            isReturn: entry.isReturn
        }
        );

        //矢印操作で変数を識別する情報
        const endpoint = {
            kind: "variable",
            frameId: frame.frameId,
            frameDepth: frame.depth,
            name: entry.name,
            isReturn: entry.isReturn
        };

        //矢印操作の対象として登録
        this.registerArrowEndpoint(
            valueLabel.element, endpoint, valueLabel
        );

        //変数名と値を削除できるようにする
        this.registerDeleteTarget(
            nameLabel.element.add(valueLabel.element),
            endpoint
        );
}

    //基本型と参照型で処理を分ける
    renderByType(value, valueLabel, source){
        //参照型の場合
        if(value.kind === "reference"){
            //参照先IDを表示（テスト用）
            //valueLabel.element.text(`参照先:${value.id}`);
            valueLabel.element.text("●");

            //参照関係を保存する
            this.referenceRelation(
                source,
                value.id,
                valueLabel
            );

            return;
        }

        //基本型, null, voidの場合
        this.renderPrimitiveObject(value, valueLabel);
    }

    //後で描画する参照矢印の情報を保存する
    referenceRelation(source, targetId, sourceLabel){
        this.referenceRelations.push({
            //参照元の情報
            source: source,
            //参照先オブジェクトのID
            targetId: targetId,
            //矢印の始点位置を取得するための表示要素
            sourceLabel: sourceLabel
        });
    }

    //基本型, null, voidを表示する
    renderPrimitiveObject(value, valueLabel){
        let text;

        if(value.kind === "value"){
            text = String(value.value);
        }else if(value.kind === "null"){
            text = "null"
        }else if(value.kind === "void"){
            text = "<void value>"
        //解答用
        }else if(value.kind === "empty"){
            text = "";
        }

        valueLabel.element.text(text);
    }

    //フレーム内の変数と戻り値を表示用の配列にまとめる
    getFrameEntries(frame){
        const entries = [];

        //ローカル変数を取り出す
        for(const [name, value] of Object.entries(frame.locals ?? {})){
            entries.push({
                name: name,
                value: value,
                isReturn: false
            });
        }
        //戻り値が記録されている場合
        if(frame.retval != null){
            entries.push({
                name: "retval",
                value: frame.retval,
                isReturn: true
            });
        }
        return entries;
    }

    //標準出力の表示
    renderStdout(){
        //現在のトレースを取得
        const curEntry = this.curTrace[this.curInstr];

        //標準出力の表示領域を取得
        const javaStdout = document.getElementById("javaStdout");

        //標準出力を表示
        javaStdout.textContent = curEntry.stdout ?? "";
    }

    //エラーメッセージの表示
    renderError(){
        //現在のトレースを取得
        const curEntry = this.curTrace[this.curInstr];

        //エラーの表示領域を取得
        const errorOutput = document.getElementById("errorOutput");

        //エラーがない場合
        if(curEntry.exception == null){
            errorOutput.textContent = "";
            errorOutput.style.display = "none";
            return;
        }
        //ある場合
        else{
            const exception = curEntry.exception;

            //エラーの種類とメッセージを表示
            errorOutput.textContent =  `${exception.exceptionType}: ${exception.message ?? ""}`;
            errorOutput.style.display = "block";
        }

    }

    //直前に実行した行と次に実行する行を取得する
    updateCurPrevLines(){
        //現在のステップ
        const curEntry = this.curTrace[this.curInstr];

        //1つ前のステップ
        const prevEntry = this.curInstr>this.firstInstr ? this.curTrace[this.curInstr-1] : null;

        //次に実行する行
        this.curLineNumber = curEntry.location.line ?? null;

        //直前に実行した行
        this.prevLineNumber = prevEntry?.location.line ?? null;

        //直前がmethodExitの場合
        if(prevEntry?.eventKind === "methodExit" && prevEntry.frames?.length > 1){
            //終了したメソッドのフレームを取得
            const retFrame = prevEntry.frames.at(-1);

            //終了したメソッドのフレームIDを取得
            const retFrameId = retFrame?.frameId;

            if(retFrameId != null){
                //対応するメソッド呼び出しを見つける
                for(let i = this.curInstr-1;i>=this.firstInstr; i--){
                    const entry = this.curTrace[i];

                    //最初のフレームを取得
                    const topFrame = entry.frames?.at(-1);

                    //終了したメソッドの開始イベントを探す
                    if(entry.eventKind === "methodEntry" && topFrame?.frameId === retFrameId){
                        //メソッド呼び出しをした行を取得
                        if(i>this.firstInstr){
                            const callingEntry = this.curTrace[i-1];

                            this.prevLineNumber = callingEntry.location?.line ?? this.prevLineNumber;
                        }
                        break;
                    }
                }
            }
        }

        //mainメソッドが終了した最後のステップ
        if(
            this.curInstr === this.lastInstr &&
            (curEntry.eventKind === "methodExit" ||
            curEntry.eventKind === "Exception") &&
            curEntry.frames?.length === 1
        ){
            this.curLineNumber = null;
        }
    }

    //ステップのコードに関する変更
    updateCodeOutput(curEntry){
        
        //前のステップの強調表示をなくす
        if (this.highlightedCurLine != null) {
            this.codeView.unhighlight(this.highlightedCurLine);
        }
        //前回の「直前に実行した行」のハイライトを解除
        if(this.highlightedPrevLine != null){
            this.codeView.removeClass(
            this.highlightedPrevLine,
            "jsav-prev-line"
            );
        }
        //直前に実行した行と次に実行する行を取得
        this.updateCurPrevLines();

        //前回ハイライトした行を初期化
        this.highlightedCurLine = null;
        this.highlightedPrevLine = null;

        //直前に実行した行をハイライト
        if(
            this.prevLineNumber != null &&
            this.prevLineNumber >= 1 &&
            this.prevLineNumber <= this.curInputCode.length &&
            this.prevLineNumber !== this.curLineNumber
        ){
            this.codeView.addClass(
                this.prevLineNumber,
                "jsav-prev-line"
            );
            //ハイライトした行を保存
            this.highlightedPrevLine = this.prevLineNumber;
        }

        //次に実行する行をハイライト
        if(
            this.curLineNumber != null &&
            this.curLineNumber >= 1 &&
            this.curLineNumber <= this.curInputCode.length
        ){
            this.codeView.highlight(this.curLineNumber);

            //ハイライトした行を保存
            this.highlightedCurLine = this.curLineNumber;
        }


        //現在ステップ数を表示
        this.updateStepCounter();

    }

    //現在のステップ番号と全ステップ数を画面に表示
    updateStepCounter(){
        //HTML上のステップ表示領域を取得
        const counter = document.getElementById("stepCounter");
        //console.log(this.curTrace[this.curInstr]);
        //ステップ１から始まるようにする
        counter.textContent = `Step ${this.curInstr+1} / ${this.curTrace.length}`;
    }

    //前のステップに戻る
    stepBack(){
        //問題出題中は移動できない
        if(this.activeQuestion !== null){
            return;
        }

        //可視化対象の最初のステップより後ならステップを戻す
        if(this.curInstr > this.firstInstr){
            //ステップを１戻す
            this.curInstr--;
            //ステップの状態を画面に反映
            this.updateOutput();
        }
    }
    //次のステップに進む
    stepForward(){
        //問題出題中は移動できない
        if(
            this.activeQuestion !== null ||
            this.curInstr >= this.lastInstr
        ){
            return;
        }

        //現在のステップの直後に問題があるか確認
        const question = this.findQuestionAfterCurrentStep();

        if(question !== null){
            this.startQuestion(question);
            return;
        }

         //出題位置でなければ通常のステップ移動
        this.curInstr++;
        this.updateOutput();
    }
    //最初のステップに戻る
    stepBackFirst(){
        //問題出題中は移動できない
        if(this.activeQuestion !== null){
            return;
        }

        //現在位置が最初のステップでなければ最初まで戻る
        if(this.curInstr > this.firstInstr){
            //ステップを最初まで戻す
            this.curInstr = this.firstInstr;
            //ステップの状態を画面に反映
            this.updateOutput();
        }
    }
    //最後のステップに進む
    stepForwardLast(){
        //最後のステップになるまでstepForward()を繰り返す
        while(
            this.curInstr < this.lastInstr &&
            this.activeQuestion === null
        ){
            this.stepForward();
        }
    }

} 

// 可視化プログラムを開始する処理
async function main() {
    
        // 整形済みトレースJSONを読み込む
        const trace = await loadTrace(traceFilePath);

        // 読み込んだトレースを使って可視化オブジェクトを作成する
        const visualizer = new ExecutionVisualizer("jsav_container", trace, questionSettings);

        // 最初のステップを画面に表示する
        visualizer.render();

        // 戻るボタンを押したときに前のステップへ戻る
        document
            .getElementById("stepBackButton")
            .addEventListener("click", function () {
                visualizer.stepBack();
            });
        // 次へボタンを押したときに次のステップへ進む
        document
            .getElementById("stepForwardButton")
            .addEventListener("click", function () {
                visualizer.stepForward();
            });
        // 最初のステップへ戻る
        document
            .getElementById("stepBackFirstButton")
            .addEventListener("click", function () {
                visualizer.stepBackFirst();
            });
        // 最後のステップへ進む
        document
            .getElementById("stepForwardLastButton")
            .addEventListener("click", function () {
                visualizer.stepForwardLast();
            });
        //問題のスキップ
        document
            .getElementById("skipQuestionButton")
            .addEventListener("click", function () {
                visualizer.skipQuestion();
            });
        //値の変更ボタンを押した時
        document
            .getElementById("editValueButton")
            .addEventListener("click", function(){
                visualizer.setEditMode("value");
            })
        //矢印ボタンを押した時
        document
            .getElementById("editArrowButton")
            .addEventListener("click", function(){
                visualizer.setEditMode("arrow");
            })
        //変数の追加フォームを開いたとき，最新の解答状態から追加先を作り直す
        document
            .getElementById("addVariableMenu")
            .addEventListener("toggle", function(){
                if(this.open){
                    document.getElementById("addObjectMenu").open = false;
                    visualizer.updateAddVariableOptions();
                }
            });

        //追加先を変更したら，新規フレーム用の入力欄を切り替える
        document
            .getElementById("addVariableTarget")
            .addEventListener("change", function(){
                visualizer.updateAddVariableFields();
            });

        //変数の追加フォームを確定する
        document
            .getElementById("addVariableForm")
            .addEventListener("submit", function(event){
                event.preventDefault(); //画面の再読み込みを防ぐ
                const input = visualizer.getAddVariableInput();
                if(input !== null && visualizer.addVariable(input) === true){
                    this.reset();
                    document.getElementById("addVariableMenu").open = false;
                }
            });

        //オブジェクトの追加フォームを開いたとき，もう一方を閉じる
        document
            .getElementById("addObjectMenu")
            .addEventListener("toggle", function(){
                if(this.open){
                    document.getElementById("addVariableMenu").open = false;
                    visualizer.updateAddObjectFields();
                }
            });

        //オブジェクトの種類を変更したら，配列長の入力欄を切り替える
        document
        .getElementById("addObjectKind")
            .addEventListener("change", function(){
                visualizer.updateAddObjectFields();
            });

        //オブジェクトの追加フォームを確定する
        document
            .getElementById("addObjectForm")
            .addEventListener("submit", function(event){
                event.preventDefault(); //画面の再読み込みを防ぐ
                const input = visualizer.getAddObjectInput();
                if(input !== null){
                    visualizer.addObject(input);
                    this.reset();
                    document.getElementById("addObjectMenu").open = false;
                }
            });
        //変数，オブジェクト削除ボタン
        document
            .getElementById("deleteButton")
            .addEventListener("click", function(){
                visualizer.setEditMode("deleteStructure");
            })
        //解答状態を1つ前に戻すボタン
        document
            .getElementById("undoAnswerButton")
            .addEventListener("click", function(){
                visualizer.undoAnswer();
            });

        //解答開始直後の状態に戻すボタン
        document
            .getElementById("resetAnswerButton")
            .addEventListener("click", function(){
                visualizer.resetAnswer();
            });

        //解答確認ボタン
        document
            .getElementById("checkAnswerButton")
            .addEventListener("click", function(){
                visualizer.checkAnswer();
            });   
}

main();
