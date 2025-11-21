document.addEventListener('DOMContentLoaded', function() {

    // --- CẤU HÌNH & BIẾN TOÀN CỤC ---
    const TEACHER_PASSWORD = '172119'; // Mật khẩu giáo viên (vẫn giữ cách cũ)

    // --- Cấu hình Supabase ---
    const SUPABASE_URL = 'https://nwttcewahludqajptnxe.supabase.co'; // Thay bằng Project URL Supabase
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53dHRjZXdhaGx1ZHFhanB0bnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE3NTYxNzMsImV4cCI6MjA3NzMzMjE3M30.HcYbP0lvB46oEU8hZX-X2PagWF1E4NmADq9-3Kyxchg'; // Thay bằng khóa anon public Supabase
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabase = supabase; // Đưa vào biến toàn cục để tiện dùng

    // --- Cấu hình Cloudinary ---
    const CLOUDINARY_CLOUD_NAME = 'dfbl99all'; // Thay bằng Cloud Name Cloudinary
    const CLOUDINARY_UPLOAD_PRESET = 'web_thi'; // Thay bằng Upload Preset Cloudinary

    let currentUser = null; // Lưu thông tin người dùng đang đăng nhập (từ Supabase)
    let parsedQuestions = [];
    let currentEditingExamId = null; // Lưu ID (uuid) của đề đang sửa
    let currentTakingExam = null; // Lưu thông tin đề đang làm
    let currentSubmissionId = null; // Lưu ID (uuid) của bài làm đang thực hiện
    let currentQuestionIndex = 0;
    let studentAnswers = {};
    let timerInterval = null;
    let lastSubmissionData = null; // Dùng để xem lại bài
    let modalConfirmCallback = null;
    let currentViewingResults = { examId: null, examTitle: null };

    // --- QUẢN LÝ TRẠNG THÁI AUTHENTICATION (SUPABASE) ---
    supabase.auth.onAuthStateChange((event, session) => {
        const loadingView = document.getElementById('loading-view');
        const teacherDashboardView = document.getElementById('teacher-dashboard-view');
        
        currentUser = session?.user || null; // Lấy thông tin user từ session

        if (currentUser) {
            // Người dùng đã đăng nhập
            if (!teacherDashboardView || !teacherDashboardView.classList.contains('active-view')) {
                 showStudentPortal(); // Chuyển đến trang học sinh
            }
        } else {
            // Người dùng đã đăng xuất hoặc chưa đăng nhập
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
            showView('role-selection-view'); // Về trang chọn vai trò
        }
        if (loadingView) loadingView.classList.remove('active-view');
    });

    // --- KHỞI TẠO ---
    const docxInput = document.getElementById('docx-file-input');
    if (docxInput) docxInput.addEventListener('change', handleFileSelect, false);
    
    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (confirmBtn) confirmBtn.onclick = () => { if (modalConfirmCallback) modalConfirmCallback(); };
    
    const cancelBtn = document.getElementById('modal-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = hideModal;

    // --- QUẢN LÝ GIAO DIỆN ---
    function showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
        const viewToShow = document.getElementById(viewId);
        if(viewToShow) viewToShow.classList.add('active-view');
        
        const logoutButton = document.getElementById('logout-button');
        const teacherViews = ['teacher-dashboard-view', 'exam-editor-view', 'teacher-results-view'];
        
        if (teacherViews.includes(viewId)) {
            logoutButton.textContent = 'Đăng xuất (GV)';
            logoutButton.onclick = () => {
                // Tạm thời chỉ quay về trang chọn vai trò cho GV
                showView('role-selection-view');
            };
            logoutButton.style.display = 'block';
        } else if (currentUser) {
            logoutButton.textContent = 'Đăng xuất';
            logoutButton.onclick = handleLogout; // Gọi hàm đăng xuất Supabase
            logoutButton.style.display = 'block';
        } else {
            logoutButton.style.display = 'none';
        }
    }

    // --- LOGIC CỦA GIÁO VIÊN ---
    function checkTeacherPassword() {
        if (document.getElementById('teacher-password-input').value === TEACHER_PASSWORD) {
            document.getElementById('password-error').classList.add('hidden');
            document.getElementById('teacher-password-input').value = '';
            showView('teacher-dashboard-view');
            loadExamsForTeacher();
        } else { document.getElementById('password-error').classList.remove('hidden'); }
    }

    async function loadExamsForTeacher() {
        const listEl = document.getElementById('teacher-exam-list');
        const loader = document.getElementById('exam-list-loader');
        if (loader) loader.style.display = 'block';
        listEl.innerHTML = '';
        try {
            // Lấy danh sách đề thi từ bảng 'exams', sắp xếp theo thời gian tạo mới nhất
            const { data: exams, error } = await supabase
                .from('exams')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!exams || exams.length === 0) {
                listEl.innerHTML = '<p class="text-slate-500">Chưa có đề thi nào được tạo.</p>';
            } else {
                exams.forEach(exam => {
                    const isOpen = exam.isOpen !== false;
                    // ... (Phần hiển thị HTML giữ nguyên logic cũ, chỉ thay đổi cách gọi hàm onclick) ...
                    const examEl = document.createElement('div');
                    examEl.className = 'flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-200 hover:shadow-md hover:border-indigo-200 transition';
                    examEl.innerHTML = `
                        <div>
                            <p class="font-bold text-slate-700">${exam.title}</p>
                            <div class="flex items-center gap-4 mt-1">
                                <p class="text-sm text-slate-500">${exam.questionCount || 0} câu hỏi - ${exam.timeLimit} phút</p>
                                <p class="text-sm font-bold ${isOpen ? 'text-green-600' : 'text-red-600'}">• ${isOpen ? 'Đang mở' : 'Đã đóng'}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="window.toggleExamStatus('${exam.id}', ${isOpen})" class="text-sm ${isOpen ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'} text-white py-2 px-3 rounded-lg">${isOpen ? 'Đóng đề' : 'Mở đề'}</button>
                            <button onclick="window.viewResults('${exam.id}', '${exam.title.replace(/'/g, "\\'")}')" class="text-sm bg-indigo-500 text-white py-2 px-3 rounded-lg hover:bg-indigo-600">Kết quả</button>
                            <button onclick="window.editExam('${exam.id}')" class="text-sm bg-slate-500 text-white py-2 px-3 rounded-lg hover:bg-slate-600">Sửa</button>
                            <button onclick="window.confirmDeleteExam('${exam.id}', '${exam.title.replace(/'/g, "\\'")}')" class="text-sm bg-red-500 text-white py-2 px-3 rounded-lg hover:bg-red-600">Xóa</button>
                        </div>`;
                    listEl.appendChild(examEl);
                });
            }
        } catch (error) {
            console.error("Lỗi khi tải danh sách đề thi:", error);
            listEl.innerHTML = '<p class="text-red-500">Lỗi khi tải danh sách đề thi.</p>';
        } finally {
            if (loader) loader.style.display = 'none';
        }
    }

    function handleFileSelect(event) {
        const file = event.target.files[0]; if (!file) return;
        const loader = document.getElementById('upload-loader');
        const errorEl = document.getElementById('upload-error');
        loader.style.display = 'block';
        errorEl.classList.add('hidden');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
                parsedQuestions = parseHtmlToQuestions(result.value);
                if (parsedQuestions.length === 0) { throw new Error("Không tìm thấy câu hỏi nào. Vui lòng kiểm tra lại cấu trúc file Word."); }
                currentEditingExamId = null;
                document.getElementById('exam-title').value = file.name.replace(/\.docx$/, '');
                document.getElementById('exam-time-limit').value = 90;
                renderQuestionEditor(parsedQuestions);
                showView('exam-editor-view');
                setTimeout(() => MathJax.typesetPromise(), 100);
            } catch (err) {
                console.error('Error parsing DOCX:', err);
                errorEl.textContent = err.message;
                errorEl.classList.remove('hidden');
            } finally {
                loader.style.display = 'none';
                event.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    }

   function parseHtmlToQuestions(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const questions = [];
        let currentPart = 0;
        let currentQuestion = null;
        const part_pattern = /^\s*PHẦN\s+(I|II|III)\b\.?\s*$/i;
        const question_pattern = /^\s*(<strong>)?\s*Câu\s*\d+[:.]?/i;
        const mc_option_pattern = /^\s*[A-D]\.\s*/;
        const tf_option_pattern = /^\s*[a-d]\)\s*/;
        const elements = Array.from(tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, table'));
        for (const el of elements) {
            const textContent = el.textContent.trim();
            const innerHTML = el.innerHTML.trim();
            if (textContent === '' && el.tagName.toLowerCase() !== 'table') continue;
            const partMatch = textContent.match(part_pattern);
            if (partMatch) {
                if (currentQuestion) { questions.push(currentQuestion); currentQuestion = null; }
                const partRoman = partMatch[1].toUpperCase();
                if (partRoman === 'I') currentPart = 1;
                else if (partRoman === 'II') currentPart = 2;
                else if (partRoman === 'III') currentPart = 3;
                continue;
            }
            if (currentQuestion && el.tagName.toLowerCase() === 'table') {
                currentQuestion.content += el.outerHTML;
                continue;
            }
            const isNewQuestion = question_pattern.test(textContent);
            if (isNewQuestion && currentPart > 0) {
                if (currentQuestion) questions.push(currentQuestion);
                let question_type = '';
                if (currentPart === 1) question_type = 'multiple_choice';
                else if (currentPart === 2) question_type = 'true_false';
                else if (currentPart === 3) question_type = 'short_answer';
                currentQuestion = { content: innerHTML.replace(question_pattern, '').trim(), question_type: question_type, options: [] };
                continue;
            }
            if (currentQuestion) {
                const isMcOption = currentQuestion.question_type === 'multiple_choice' && mc_option_pattern.test(textContent);
                const isTfOption = currentQuestion.question_type === 'true_false' && tf_option_pattern.test(textContent);
                if (isMcOption) {
                    const key = textContent.match(mc_option_pattern)[0].trim().slice(0, 1);
                    const value = innerHTML.replace(mc_option_pattern, '').trim();
                    currentQuestion.options.push({ key, value });
                } else if (isTfOption) {
                    const key = textContent.match(tf_option_pattern)[0].trim().slice(0, 1);
                    const value = innerHTML.replace(tf_option_pattern, '').trim();
                    currentQuestion.options.push({ key, value });
                } 
                else if (!textContent.includes('Thí sinh trả lời') && el.closest('table') === null) {
                    currentQuestion.content += '<br>' + innerHTML;
                }
            }
        }
        if (currentQuestion) questions.push(currentQuestion);
        return questions;
    }

    function renderQuestionEditor(questionsToRender) {
        const container = document.getElementById('question-editor-container'); container.innerHTML = '';
        let currentPartRendered = 0;
        questionsToRender.forEach((q, index) => {
            let partNumber = 0, partTitle = '';
            if (q.question_type === 'multiple_choice') { partNumber = 1; partTitle = 'PHẦN I: TRẮC NGHIỆM NHIỀU LỰA CHỌN'; }
            else if (q.question_type === 'true_false') { partNumber = 2; partTitle = 'PHẦN II: CÂU TRẮC NGHIỆM ĐÚNG SAI'; }
            else if (q.question_type === 'short_answer') { partNumber = 3; partTitle = 'PHẦN III: CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN'; }
            if (partNumber > 0 && partNumber > currentPartRendered) {
                const titleEl = document.createElement('h2');
                titleEl.className = 'text-2xl font-bold text-slate-700 border-b-2 border-slate-200 pb-2 mb-4';
                titleEl.textContent = partTitle;
                container.appendChild(titleEl);
                currentPartRendered = partNumber;
            }
            const questionDiv = document.createElement('div');
            questionDiv.className = 'border-t border-slate-200 pt-6';
            let answerInputHtml = '', defaultPoints = 0;
            const questionContentEditable = `<div contenteditable="true" id="content_${index}" class="question-content-editable font-semibold text-slate-800 math-container p-3 border border-dashed border-slate-300 rounded-md bg-slate-50">${q.content}</div><button onclick="triggerImageUpload(${index})" class="mt-2 text-xs bg-slate-200 hover:bg-slate-300 py-1 px-2 rounded-md text-slate-600">Thêm ảnh</button><input type="file" id="image_upload_${index}" class="hidden" accept="image/*" onchange="insertImage(event, ${index})">`;
            if (q.question_type === 'multiple_choice') {
                defaultPoints = 0.25;
                answerInputHtml = q.options.map(({ key, value }) => `<div class="flex items-center my-2"><input type="radio" name="answer_${index}" value="${key}" id="ans_${index}_${key}" onclick="toggleRadio(this)" class="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"><label for="ans_${index}_${key}" class="math-container text-slate-700 font-times">${key}. ${value}</label></div>`).join('');
            } else if (q.question_type === 'true_false') {
                defaultPoints = 1;
                answerInputHtml = q.options.map(({ key, value }) => `<div class="flex items-center justify-between my-1 py-2 px-3 rounded-lg hover:bg-slate-50"><div class="math-container text-slate-700 mr-4">${key}) ${value}</div><div class="flex items-center gap-x-2"><div><input type="radio" name="answer_${index}_${key}" value="Đúng" id="ans_${index}_${key}_true" onclick="toggleRadio(this)" class="hidden peer"><label for="ans_${index}_${key}_true" class="cursor-pointer py-2 px-5 text-sm font-medium rounded-full border border-slate-300 bg-white text-slate-600 transition-colors duration-200 ease-in-out hover:bg-slate-100 peer-checked:bg-green-600 peer-checked:text-white peer-checked:border-green-600">Đúng</label></div><div><input type="radio" name="answer_${index}_${key}" value="Sai" id="ans_${index}_${key}_false" onclick="toggleRadio(this)" class="hidden peer"><label for="ans_${index}_${key}_false" class="cursor-pointer py-2 px-5 text-sm font-medium rounded-full border border-slate-300 bg-white text-slate-600 transition-colors duration-200 ease-in-out hover:bg-slate-100 peer-checked:bg-red-600 peer-checked:text-white peer-checked:border-red-600">Sai</label></div></div></div>`).join('');
            } else if (q.question_type === 'short_answer') {
                defaultPoints = 0.5;
                answerInputHtml = `<input type="text" id="answer_${index}" class="mt-2 w-full p-2 border border-slate-300 rounded-lg" placeholder="Nhập đáp án ngắn...">`;
            }
            questionDiv.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-4 gap-6 items-start"><div class="md:col-span-3"><label class="block text-sm font-medium text-slate-600 mb-1">Nội dung Câu ${index + 1}:</label>${questionContentEditable}</div><div class="md:col-span-1"><label class="block text-sm font-medium text-slate-600 mb-1">Điểm</label><input type="number" id="points_${index}" class="w-full p-2 border border-slate-300 rounded-lg" value="${q.points || defaultPoints}" step="0.05"></div></div><div class="mt-4"><h4 class="font-medium text-slate-600">Thiết lập đáp án đúng:</h4><div class="p-2 space-y-1">${answerInputHtml}</div></div>`;
            container.appendChild(questionDiv);
            if (q.correct_answer) {
                if (q.question_type === 'multiple_choice' && q.correct_answer.answer) {
                    const radio = document.querySelector(`input[name="answer_${index}"][value="${q.correct_answer.answer}"]`);
                    if (radio) { radio.checked = true; radio.setAttribute('data-was-checked', 'true'); }
                } else if (q.question_type === 'short_answer') {
                    document.getElementById(`answer_${index}`).value = q.correct_answer.answer || '';
                } else if (q.question_type === 'true_false') {
                    Object.entries(q.correct_answer).forEach(([key, val]) => {
                        const radio = document.querySelector(`input[name="answer_${index}_${key}"][value="${val}"]`);
                        if (radio) { radio.checked = true; radio.setAttribute('data-was-checked', 'true'); }
                    });
                }
            }
        });
    }

    // *** VIẾT LẠI HÀM LƯU ĐỀ THI – BẢO ĐẢM LƯU ĐÚNG ĐÁP ÁN ***
    async function saveExam() {
        const saveButton = document.getElementById('save-exam-button');
        const loader = document.getElementById('save-loader');
        saveButton.disabled = true;
        loader.style.display = 'block';

        try {
            const examTitle = document.getElementById('exam-title').value.trim();
            const timeLimit = parseInt(document.getElementById('exam-time-limit').value, 10);

            if (!examTitle || !timeLimit) {
                alert('Vui lòng nhập đầy đủ Tiêu đề và Thời gian làm bài.');
                return;
            }

            const settings = {
                showScore: document.querySelector('input[name="showScoreOption"]:checked').value,
                allowReview: document.querySelector('input[name="allowReviewOption"]:checked').value,
                attempts: document.querySelector('input[name="attemptsOption"]:checked').value
            };

            // 1. Chuẩn bị dữ liệu câu hỏi
            const questionsData = [];

            for (let i = 0; i < parsedQuestions.length; i++) {
                const q = parsedQuestions[i];

                // Nội dung câu hỏi (bao gồm cả <img> nếu có)
                const contentEl = document.getElementById(`content_${i}`);
                const content = contentEl ? contentEl.innerHTML : (q.content || '');

                // Điểm số
                const pointsInput = document.getElementById(`points_${i}`);
                let points = pointsInput ? parseFloat(pointsInput.value) : q.points;
                if (isNaN(points)) points = 0;

                // Lấy đáp án đúng
                let correct_answer = null;

                if (q.question_type === 'multiple_choice') {
                    // GV chọn 1 đáp án đúng bằng radio: name="answer_i"
                    const checked = document.querySelector(`input[name="answer_${i}"]:checked`);
                    if (checked) {
                        correct_answer = { answer: checked.value }; // ví dụ { answer: 'A' }
                    }
                } else if (q.question_type === 'short_answer') {
                    // GV nhập đáp án text: id="answer_i"
                    const ansInput = document.getElementById(`answer_${i}`);
                    const ans = ansInput ? ansInput.value.trim() : '';
                    correct_answer = { answer: ans };
                } else if (q.question_type === 'true_false') {
                    // Mỗi mệnh đề a,b,c,d có 2 radio: name="answer_i_a", "answer_i_b", ...
                    const tfAnswer = {};
                    (q.options || []).forEach(({ key }) => {
                        const checked = document.querySelector(
                            `input[name="answer_${i}_${key}"]:checked`
                        );
                        if (checked) {
                            tfAnswer[key] = checked.value; // 'Đúng' hoặc 'Sai'
                        }
                    });
                    correct_answer = Object.keys(tfAnswer).length > 0 ? tfAnswer : null;
                }

                // Bỏ id (và imageUrl nếu có) để tránh đụng PK / cột không tồn tại
                const { id, imageUrl, ...questionPayload } = q;

                questionsData.push({
                    ...questionPayload,
                    content,
                    points,
                    correct_answer,
                    order: i
                });
            }

            // 2. Payload đề thi
            const examPayload = {
                title: examTitle,
                timeLimit: timeLimit,
                questionCount: questionsData.length,
                isOpen: true,
                settings: settings
            };

            let examId = currentEditingExamId;

            // 3. Tạo mới hoặc cập nhật đề thi
            if (examId) {
                // Cập nhật thông tin đề
                const { error: updateExamError } = await supabase
                    .from('exams')
                    .update(examPayload)
                    .eq('id', examId);
                if (updateExamError) throw updateExamError;

                // Xóa toàn bộ câu hỏi cũ của đề này
                const { error: deleteQuestionsError } = await supabase
                    .from('questions')
                    .delete()
                    .eq('exam_id', examId);
                if (deleteQuestionsError) throw deleteQuestionsError;
            } else {
                // Tạo đề thi mới
                const { data: newExamData, error: insertExamError } = await supabase
                    .from('exams')
                    .insert(examPayload)
                    .select('id')
                    .single();

                if (insertExamError) throw insertExamError;
                if (!newExamData || !newExamData.id) {
                    throw new Error("Không thể tạo đề thi mới.");
                }
                examId = newExamData.id;
            }

            // 4. Thêm lại toàn bộ câu hỏi với exam_id mới
            const questionsWithExamId = questionsData.map(q => ({ ...q, exam_id: examId }));
            const { error: insertQuestionsError } = await supabase
                .from('questions')
                .insert(questionsWithExamId);

            if (insertQuestionsError) throw insertQuestionsError;

            alert('Lưu đề thi thành công!');
            showView('teacher-dashboard-view');
            loadExamsForTeacher();
        } catch (error) {
            console.error("Lỗi khi lưu đề thi:", error);
            alert("Đã có lỗi xảy ra khi lưu đề thi: " + error.message);
        } finally {
            saveButton.disabled = false;
            loader.style.display = 'none';
        }
    }


    // *** VIẾT LẠI HÀM SỬA ĐỀ THI ***
    async function editExam(examId) {
        try {
            showView('exam-editor-view');
            const container = document.getElementById('question-editor-container');
            container.innerHTML = '<div class="loader mx-auto"></div>';

            // 1. Lấy thông tin đề thi
            const { data: examData, error: examError } = await supabase
                .from('exams')
                .select('*')
                .eq('id', examId)
                .single(); // Chỉ mong đợi 1 kết quả

            if (examError || !examData) throw examError || new Error("Không tìm thấy đề thi.");

            currentEditingExamId = examId;
            document.getElementById('exam-title').value = examData.title;
            document.getElementById('exam-time-limit').value = examData.timeLimit;
            const settings = examData.settings || { showScore: 'immediately', allowReview: 'immediately', attempts: 'single' };
            // ... (cập nhật radio button như cũ) ...

            // 2. Lấy danh sách câu hỏi liên quan, sắp xếp theo 'order'
            const { data: questions, error: questionsError } = await supabase
                .from('questions')
                .select('*')
                .eq('exam_id', examId)
                .order('order', { ascending: true });

            if (questionsError) throw questionsError;

            parsedQuestions = questions || []; // Lưu lại danh sách câu hỏi

            renderQuestionEditor(parsedQuestions);
            setTimeout(() => MathJax.typesetPromise(), 100);

        } catch (error) {
            console.error("Lỗi khi tải đề thi để sửa:", error);
            alert("Không thể tải dữ liệu đề thi để sửa: " + error.message);
            showView('teacher-dashboard-view');
        }
    }

    // *** VIẾT LẠI HÀM XÓA ĐỀ THI ***
    function confirmDeleteExam(examId, examTitle) {
        const message = `
            Bạn có chắc chắn muốn xóa đề:<br>
            <strong>${examTitle}</strong>?<br>
            Hành động này sẽ xóa tất cả câu hỏi và bài làm liên quan.
        `;

        showModal('Xác nhận xóa đề thi', message, async () => {
            const loader = document.getElementById('exam-list-loader');
            if (loader) loader.style.display = 'block';
            try {
                const { error } = await supabase
                    .from('exams')
                    .delete()
                    .eq('id', examId);

                if (error) {
                    console.error("Lỗi khi xóa đề thi:", error);
                    alert("Đã có lỗi xảy ra trong quá trình xóa đề thi: " + error.message);
                    return;
                }

                alert("Xóa đề thi thành công!");
            } catch (err) {
                console.error("Lỗi xóa đề thi:", err);
                alert("Đã có lỗi xảy ra: " + err.message);
            } finally {
                hideModal();
                loadExamsForTeacher();
            }
        });
    }


    async function toggleExamStatus(examId, currentStatus) {
        try {
            const { error } = await supabase
                .from('exams')
                .update({ isOpen: !currentStatus })
                .eq('id', examId);
            if (error) throw error;
            loadExamsForTeacher();
        } catch (error) {
            console.error("Lỗi khi thay đổi trạng thái đề thi:", error);
            alert("Đã có lỗi xảy ra: " + error.message);
        }
    }

    async function viewResults(examId, examTitle) {
        currentViewingResults.examId = examId;
        currentViewingResults.examTitle = examTitle;
        showView('teacher-results-view');
        document.getElementById('results-exam-title').textContent = `Đề: ${examTitle}`;
        const tableBody = document.getElementById('results-table-body');
        const table = document.getElementById('results-table');
        const loader = document.getElementById('results-loader');
        const noResultsMsg = document.getElementById('no-results-message');
        table.classList.add('hidden');
        noResultsMsg.classList.add('hidden');
        loader.classList.remove('hidden');
        tableBody.innerHTML = '';
            try {

            const { data: results, error } = await supabase
                .from('submissions')
                .select('*')
                .eq('exam_id', examId);

            if (error) throw error;

            if (!results || results.length === 0) {
                noResultsMsg.classList.remove('hidden');
            } else {
                let index = 1;

                results.sort((a, b) => (b.score || -1) - (a.score || -1));
                results.forEach(result => {
                    const row = tableBody.insertRow();
                    const submissionTime = result.endTime ? new Date(result.endTime).toLocaleString('vi-VN') : 'Chưa nộp';
                    row.innerHTML = `
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">${index++}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-500">${result.studentName}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-500">${submissionTime}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">${result.score !== null ? result.score : 'N/A'}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm">
                            <button onclick="confirmDeleteSubmission('${result.id}', '${result.studentName.replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-800 font-medium">Xóa</button>
                        </td>
                    `;
                });
                table.classList.remove('hidden');
            }
        } catch (error) {
            console.error("Lỗi khi xem kết quả:", error);
            noResultsMsg.textContent = "Đã có lỗi xảy ra khi tải kết quả.";
            noResultsMsg.classList.remove('hidden');
        } finally {
            loader.classList.add('hidden');
        }
    }

    // *** VIẾT LẠI HÀM XÓA BÀI LÀM ***
     function confirmDeleteSubmission(submissionId, studentName) {
        const message = `Bạn có chắc chắn muốn xóa vĩnh viễn bài làm của học sinh "${studentName}" không?`;
        showModal('Xác nhận Xóa', message, () => deleteSubmission(submissionId));
    }
    async function deleteSubmission(submissionId) {
        try {
            const { error } = await supabase
                .from('submissions')
                .delete()
                .eq('id', submissionId);
            if (error) throw error;
            hideModal();
            // Tải lại kết quả nếu đang xem
            if (currentViewingResults.examId) {
                viewResults(currentViewingResults.examId, currentViewingResults.examTitle);
            }
        } catch (error) {
            console.error("Lỗi khi xóa bài làm:", error);
            alert("Đã có lỗi xảy ra khi xóa bài làm: " + error.message);
            hideModal();
        }
    }

    // Upload ảnh lên Cloudinary và chèn vào nội dung câu hỏi
    async function insertImage(event, index) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

            const res = await fetch(url, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok || data.error) {
                console.error("Cloudinary error:", data.error || data);
                alert("Không upload được ảnh lên Cloudinary. Vui lòng kiểm tra lại CLOUD_NAME và UPLOAD_PRESET.");
                return;
            }

            const imageUrl = data.secure_url;
            if (!imageUrl) {
                alert("Không lấy được đường dẫn ảnh từ Cloudinary.");
                return;
            }

            const contentDiv = document.getElementById(`content_${index}`);
            if (contentDiv) {
                contentDiv.innerHTML += `<br><img src="${imageUrl}" alt="Hình minh họa" class="max-w-full mt-2">`;
            }

            if (Array.isArray(parsedQuestions) && parsedQuestions[index]) {
                parsedQuestions[index].imageUrl = imageUrl;
            }

            if (window.MathJax && window.MathJax.typesetPromise) {
                setTimeout(() => MathJax.typesetPromise(), 50);
            }

            event.target.value = '';

        } catch (err) {
            console.error("Lỗi upload ảnh Cloudinary:", err);
            alert("Đã xảy ra lỗi khi upload ảnh. Vui lòng thử lại.");
        }
    }

    function triggerImageUpload(index) { document.getElementById(`image_upload_${index}`).click(); }


    // --- HÀM XỬ LÝ AUTHENTICATION (SUPABASE) ---
    async function handleRegister() {
        const fullName = document.getElementById('register-fullname').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const errorEl = document.getElementById('register-error');
        errorEl.classList.add('hidden');
        if (!fullName || !email || !password) { /* ... báo lỗi ... */ return; }

        try {
            // Đăng ký người dùng mới
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: { // Lưu trữ tên vào metadata (có thể lấy sau)
                        full_name: fullName
                    }
                }
            });
            if (error) throw error;
            // Supabase mặc định cần xác thực email, nếu không muốn, cần tắt trong cài đặt
            alert('Đăng ký thành công! Vui lòng kiểm tra email để xác thực (nếu được yêu cầu) và sau đó đăng nhập.');
            showView('login-view');
        } catch (error) {
            console.error("Lỗi Đăng ký:", error);
            errorEl.textContent = error.message; // Hiển thị lỗi từ Supabase
            errorEl.classList.remove('hidden');
        }
    }

    async function handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        errorEl.classList.add('hidden');
        if (!email || !password) { /* ... báo lỗi ... */ return; }

        try {
            // Đăng nhập
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });
            if (error) throw error;
            // onAuthStateChange sẽ tự động xử lý chuyển màn hình
        } catch (error) {
            console.error("Lỗi Đăng nhập:", error);
            errorEl.textContent = "Email hoặc mật khẩu không chính xác.";
            errorEl.classList.remove('hidden');
        }
    }

    async function handleLogout() {
        try {
            // Đăng xuất
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            // onAuthStateChange sẽ tự động xử lý chuyển màn hình
        } catch (error) {
            console.error("Lỗi Đăng xuất:", error);
            alert("Đã có lỗi xảy ra khi đăng xuất.");
        }
    }

    async function handlePasswordReset() {
        const email = prompt("Vui lòng nhập email của bạn để nhận link khôi phục mật khẩu:");
        if (!email || email.trim() === '') return;

        try {
            // Gửi email reset mật khẩu
            const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
                // redirectTo: 'LINK_TRANG_ĐẶT_LẠI_MẬT_KHẨU_CỦA_BẠN' // (Tùy chọn)
            });
            if (error) throw error;
            alert("Thành công! Vui lòng kiểm tra hộp thư của bạn để khôi phục mật khẩu.");
        } catch (error) {
            console.error("Lỗi Quên mật khẩu:", error);
            alert("Đã có lỗi xảy ra: " + error.message);
        }
    }

    // --- LOGIC CỦA HỌC SINH ---
    async function showStudentPortal() {
        if (!currentUser) {
            showView('login-view');
            return;
        }
        showView('student-portal-view');
        // Lấy tên từ metadata hoặc email
        const studentName = currentUser.user_metadata?.full_name || currentUser.email;
        document.getElementById('student-greeting').textContent = `Xin chào, ${studentName}!`;

        const listEl = document.getElementById('student-exam-list');
        const loader = document.getElementById('student-exam-loader');
        if (loader) loader.style.display = 'block';
        listEl.innerHTML = '';

        try {
            // 1. Lấy tất cả bài làm của học sinh này
            const { data: submissions, error: subError } = await supabase
                .from('submissions')
                .select('*')
                .eq('user_id', currentUser.id);
            if (subError) throw subError;

            // Tạo map lưu bài làm điểm cao nhất cho mỗi đề
            const submissionsMap = new Map();
            (submissions || []).forEach(sub => {
                if (!submissionsMap.has(sub.exam_id) || (submissionsMap.get(sub.exam_id).score || -1) < (sub.score || -1)) {
                    submissionsMap.set(sub.exam_id, sub);
                }
            });

            // 2. Lấy tất cả đề thi
            const { data: exams, error: examError } = await supabase
                .from('exams')
                .select('*')
                .order('created_at', { ascending: false });
            if (examError) throw examError;

            if (!exams || exams.length === 0) {
                listEl.innerHTML = '<p class="text-slate-500 text-center">Hiện chưa có đề thi nào.</p>';
            } else {
                listEl.innerHTML = ''; // Clear loader
                exams.forEach(exam => {
                    const submission = submissionsMap.get(exam.id);
                    const isOpen = exam.isOpen !== false;
                    const settings = exam.settings || { showScore: 'immediately', allowReview: 'immediately', attempts: 'single' };
                    
                    let statusHtml = '';
                    let buttonHtml = '';
                    
                    if (submission) {
                        const canReview = (settings.allowReview === 'immediately') || (settings.allowReview === 'on_close' && !isOpen);
                        const canRetake = (settings.attempts === 'unlimited') && isOpen;

                        if (settings.showScore === 'on_close' && isOpen) {
                            statusHtml = `<span class="status-badge status-done">Đã nộp</span>`;
                        } else if (submission.score !== null) {
                            statusHtml = `<span class="status-badge status-done">Điểm: ${submission.score}</span>`;
                        } else {
                            statusHtml = `<span class="status-badge status-done">Đã nộp</span>`;
                        }

                        let reviewButton = canReview ? `<button onclick="window.viewOldReview('${submission.id}')" class="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg transition text-sm">Xem lại</button>` : '';
                        let retakeButton = canRetake ? `<button onclick="window.startExamWrapper('${exam.id}')" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition text-sm">Làm lại</button>` : '';
                        
                        buttonHtml = `<div class="flex items-center gap-2">${reviewButton}${retakeButton}</div>`;
                        if (!reviewButton && !retakeButton) {
                            buttonHtml = '<button class="bg-slate-300 text-slate-500 font-bold py-2 px-4 rounded-lg cursor-not-allowed text-sm" disabled>Đã nộp</button>';
                        }

                    } else { // Chưa làm bài
                        if (!isOpen) {
                            statusHtml = '<span class="status-badge status-closed">Đã đóng</span>';
                            buttonHtml = '<button class="bg-slate-300 text-slate-500 font-bold py-2 px-4 rounded-lg cursor-not-allowed text-sm" disabled>Đã đóng</button>';
                        } else {
                            statusHtml = '<span class="status-badge status-not-done">Chưa làm</span>';
                            buttonHtml = `<button onclick="window.startExamWrapper('${exam.id}')" class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition text-sm">Làm bài</button>`;
                        }
                    }

                    const examEl = document.createElement('div');
                    examEl.className = 'p-5 bg-white rounded-xl border border-slate-200 flex justify-between items-center hover:shadow-lg hover:border-cyan-300 transition-all duration-300';
                    
                    examEl.innerHTML = `
                        <div class="flex-grow">
                            <h3 class="font-bold text-lg text-slate-800">${exam.title}</h3>
                            <div class="flex items-center gap-4 mt-1">
                                <p class="text-sm text-slate-500">${exam.questionCount || 0} câu hỏi - ${exam.timeLimit} phút</p>
                                ${statusHtml}
                            </div>
                        </div>
                        <div class="flex-shrink-0 ml-4">${buttonHtml}</div>
                    `;
 
                    listEl.appendChild(examEl);
                });
            }
        } catch (error) {
            console.error("Lỗi khi tải đề cho học sinh:", error);
            listEl.innerHTML = '<p class="text-red-500 text-center">Không thể tải danh sách đề thi.</p>';
        } finally {
            if (loader) loader.style.display = 'none';
        }
    }
    
    // *** VIẾT LẠI HÀM BẮT ĐẦU LÀM BÀI ***
    async function startExam() {
        if (!currentUser) { 
            alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
            showView('login-view');
            return; 
        }
        try {
            // 1. Lấy câu hỏi từ bảng 'questions'
            const { data: questions, error: questionsError } = await supabase
                .from('questions')
                .select('*')
                .eq('exam_id', currentTakingExam.id)
                .order('order', { ascending: true });
            if (questionsError) throw questionsError;
            currentTakingExam.questions = questions || [];

            // 2. Tạo bản ghi bài làm mới trong bảng 'submissions'
            const studentName = currentUser.user_metadata?.full_name || currentUser.email;
            const { data: newSubmissionData, error: insertSubError } = await supabase
                .from('submissions')
                .insert({
                    user_id: currentUser.id,
                    exam_id: currentTakingExam.id,
                    studentName: studentName, // Lưu lại tên để tiện hiển thị
                    startTime: new Date().toISOString(),
                    answers: {}, // Khởi tạo rỗng
                    score: null,
                    endTime: null
                })
                .select('id') // Yêu cầu trả về id
                .single(); // Chỉ mong đợi 1 kết quả

            if (insertSubError || !newSubmissionData) throw insertSubError || new Error("Không thể tạo bài làm mới.");
            currentSubmissionId = newSubmissionData.id;

            // --- CÁC DÒNG BỊ THIẾU TRƯỚC ĐÂY ---
            document.getElementById('exam-taking-title').textContent = currentTakingExam.title;
            document.getElementById('student-name-display').textContent = `Thí sinh: ${studentName}`;
            
            currentQuestionIndex = 0;
            studentAnswers = {};
            renderCurrentQuestion();
            
            // Gọi timer với cột 'timeLimit' (khớp với CSDL của bạn)
            startTimer(currentTakingExam.timeLimit); 
            
            showView('exam-taking-view'); // Chuyển sang màn hình làm bài
            window.addEventListener('beforeunload', handleBeforeUnload);
            renderQuestionPalette();

        } catch (error) {
            console.error("Lỗi khi bắt đầu bài thi:", error);
            alert("Không thể bắt đầu bài thi: " + error.message);
        }
    }

    async function startExamWrapper(examId) {
        try {
            // Lấy thông tin đề thi từ bảng 'exams'
             const { data: examData, error } = await supabase
                .from('exams')
                .select('*')
                .eq('id', examId)
                .single();
            if (error || !examData) throw error || new Error("Không tìm thấy đề thi");
            currentTakingExam = examData; // Lưu thông tin đề thi
            startExam(); // Gọi hàm bắt đầu làm bài
        } catch (error) {
            console.error("Lỗi khi chuẩn bị bài thi:", error);
            alert("Không thể tải dữ liệu đề thi.");
        }
    }

    function renderQuestionPalette() {
        const palette = document.getElementById('question-palette');
        palette.innerHTML = '';
        let currentPart = 0;
    
        currentTakingExam.questions.forEach((q, index) => {
            let partNumber = 0;
            if (q.question_type === 'multiple_choice') partNumber = 1;
            else if (q.question_type === 'true_false') partNumber = 2;
            else if (q.question_type === 'short_answer') partNumber = 3;

            if (partNumber > currentPart) {
                const titleEl = document.createElement('h3');
                titleEl.className = 'font-bold text-slate-700 mt-4 first:mt-0 text-center mb-2 col-span-5';
                titleEl.textContent = `PHẦN ${partNumber}`;
                palette.appendChild(titleEl);
                currentPart = partNumber;
            }

            const button = document.createElement('button');
            button.textContent = index + 1;
            button.onclick = () => jumpToQuestion(index);

            let classes = 'h-10 w-10 rounded-md font-medium transition-all duration-200 border ';
            const answer = studentAnswers[index];
            if (answer && (Object.keys(answer).length > 0 || (typeof answer === 'string' && answer.length > 0))) {
                classes += 'bg-green-600 border-green-600 text-white hover:bg-green-700';
            } else {
                classes += 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100';
            }

            if (index === currentQuestionIndex) {
                classes += ' ring-2 ring-offset-1 ring-indigo-500';
            }
        
            button.className = classes;
            palette.appendChild(button);
        });
    }

    function jumpToQuestion(index) {
        currentQuestionIndex = index;
        renderCurrentQuestion();
        renderQuestionPalette();
    }
    function renderCurrentQuestion() {
        const q = currentTakingExam.questions[currentQuestionIndex];
        const displayArea = document.getElementById('question-display-area');
        let optionsHtml = '';
        const savedAnswer = studentAnswers[currentQuestionIndex];
        if (q.question_type === 'multiple_choice') {
            optionsHtml = q.options.map(({ key, value }) => `<div class="flex items-center my-2 p-2 rounded-lg hover:bg-slate-50"><input type="radio" name="student_answer_${currentQuestionIndex}" value="${key}" id="stud_ans_${currentQuestionIndex}_${key}" ${savedAnswer === key ? 'checked' : ''} data-was-checked="${savedAnswer === key}" class="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300" onclick="toggleRadio(this)"><label for="stud_ans_${currentQuestionIndex}_${key}" class="math-container w-full cursor-pointer font-times">${key}. ${value}</label></div>`).join('');
        } else if (q.question_type === 'true_false') {
            optionsHtml = q.options.map(({ key, value }) => {
                const savedChoice = savedAnswer ? savedAnswer[key] : null;
                const isTrueChecked = savedChoice === 'Đúng';
                const isFalseChecked = savedChoice === 'Sai';

                return `
                <div class="flex items-center justify-between my-1 py-2 px-3 rounded-lg">
                    <div class="math-container text-slate-700 mr-4">
                        ${key}) ${value}
                    </div>
                    <div class="flex items-center gap-x-2">

                        <div>
                            <input
                                type="radio"
                                name="student_answer_${currentQuestionIndex}_${key}"
                                value="Đúng"
                                id="stud_ans_${currentQuestionIndex}_${key}_true"
                                class="hidden peer"
                                onclick="toggleRadio(this)"
                                ${isTrueChecked ? 'checked' : ''}
                                data-was-checked="${isTrueChecked}"
                            >
                            <label
                                for="stud_ans_${currentQuestionIndex}_${key}_true"
                                class="cursor-pointer py-2 px-5 text-sm font-medium rounded-full
                                       border border-slate-300 bg-white text-slate-600
                                       hover:bg-slate-100
                                       peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600"
                            >
                                Đúng
                            </label>
                        </div>

                        <!-- Nút SAI -->
                        <div>
                            <input
                                type="radio"
                                name="student_answer_${currentQuestionIndex}_${key}"
                                value="Sai"
                                id="stud_ans_${currentQuestionIndex}_${key}_false"
                                class="hidden peer"
                                onclick="toggleRadio(this)"
                                ${isFalseChecked ? 'checked' : ''}
                                data-was-checked="${isFalseChecked}"
                            >
                            <label
                                for="stud_ans_${currentQuestionIndex}_${key}_false"
                                class="cursor-pointer py-2 px-5 text-sm font-medium rounded-full
                                       border border-slate-300 bg-white text-slate-600
                                       hover:bg-slate-100
                                       peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600"
                            >
                                Sai
                            </label>
                        </div>

                    </div>
                </div>`;
            }).join('');
        } else if (q.question_type === 'short_answer') {
            optionsHtml = `<input type="text" id="student_answer_${currentQuestionIndex}" value="${savedAnswer || ''}" class="mt-2 w-full p-2 border border-slate-300 rounded-lg" placeholder="Nhập đáp án..." oninput="saveStudentAnswer()">`;
        }
        displayArea.innerHTML = `<div class="text-slate-800 math-container mb-4 font-times">
            <span class="font-bold">Câu ${currentQuestionIndex + 1}:</span> ${q.content}
        </div>
        <div class="space-y-2">${optionsHtml}</div>`;
        setTimeout(() => MathJax.typesetPromise(), 100);
        updateNavigationButtons();
    }

    function saveStudentAnswer() {
        const q = currentTakingExam.questions[currentQuestionIndex];
        if (q.question_type === 'multiple_choice') {
            const checked = document.querySelector(`input[name="student_answer_${currentQuestionIndex}"]:checked`);
            if (checked) { studentAnswers[currentQuestionIndex] = checked.value; }
            else { delete studentAnswers[currentQuestionIndex]; }
        } else if (q.question_type === 'short_answer') {
            const answer = document.getElementById(`student_answer_${currentQuestionIndex}`).value.trim();
            if (answer) { studentAnswers[currentQuestionIndex] = answer; }
            else { delete studentAnswers[currentQuestionIndex]; }
        } else if (q.question_type === 'true_false') {
            if (!studentAnswers[currentQuestionIndex]) studentAnswers[currentQuestionIndex] = {};
            let hasAnswerForPart = false;
            q.options.forEach(({ key }) => {
                const checked = document.querySelector(`input[name="student_answer_${currentQuestionIndex}_${key}"]:checked`);
                if (checked) {
                    studentAnswers[currentQuestionIndex][key] = checked.value;
                    hasAnswerForPart = true;
                } else {
                    if (studentAnswers[currentQuestionIndex]) delete studentAnswers[currentQuestionIndex][key];
                }
            });
            if (!hasAnswerForPart) { delete studentAnswers[currentQuestionIndex]; }
        }
        renderQuestionPalette();
    }

    function navigateQuestion(direction) { currentQuestionIndex += direction; renderCurrentQuestion(); renderQuestionPalette(); }

    function updateNavigationButtons() { document.getElementById('prev-question-btn').disabled = currentQuestionIndex === 0; document.getElementById('next-question-btn').style.display = currentQuestionIndex === currentTakingExam.questions.length - 1 ? 'none' : 'inline-block'; document.getElementById('submit-exam-btn').style.display = currentQuestionIndex === currentTakingExam.questions.length - 1 ? 'inline-block' : 'none'; document.getElementById('question-indicator').textContent = `Câu ${currentQuestionIndex + 1} / ${currentTakingExam.questions.length}`; }

    function startTimer(minutes) { let seconds = minutes * 60; const timerEl = document.getElementById('timer'); timerInterval = setInterval(() => { seconds--; const min = Math.floor(seconds / 60); const sec = seconds % 60; timerEl.textContent = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`; if (seconds <= 0) { clearInterval(timerInterval); alert("Hết giờ! Tự động nộp bài."); submitExam(); } }, 1000); }

    function confirmSubmitExam() { showModal('Xác nhận Nộp bài', 'Bạn có chắc chắn muốn nộp bài không?', () => { hideModal(); submitExam(); }); }

    // *** VIẾT LẠI HÀM NỘP BÀI ***
    async function submitExam() {
        clearInterval(timerInterval);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        let totalScore = 0;
        // Logic chấm điểm giữ nguyên (duyệt qua currentTakingExam.questions và studentAnswers)
        currentTakingExam.questions.forEach((q, index) => {
            const studentAns = studentAnswers[index];
            const correctAns = q.correct_answer;
            if (!studentAns) return;
            if (q.question_type === 'multiple_choice' || q.question_type === 'short_answer') {
                if (String(studentAns || '').toLowerCase() === String(correctAns.answer || '').toLowerCase()) totalScore += q.points;
            } else if (q.question_type === 'true_false') {
                let correctTfCount = 0;
                if (correctAns) {
                    Object.keys(correctAns).forEach(key => { if (studentAns && studentAns[key] && studentAns[key] === correctAns[key]) correctTfCount++; });
                }
                if (correctTfCount === 4) totalScore += 1.0;
                else if (correctTfCount === 3) totalScore += 0.5;
                else if (correctTfCount === 2) totalScore += 0.25;
                else if (correctTfCount === 1) totalScore += 0.1;
            }
        });
        totalScore = Math.round(totalScore * 100) / 100;

        try {
            // Cập nhật bản ghi bài làm trong bảng 'submissions'
            const { error } = await supabase
                .from('submissions')
                .update({
                    answers: studentAnswers,
                    score: totalScore,
                    endTime: new Date().toISOString()
                })
                .eq('id', currentSubmissionId); // Cập nhật đúng bài làm theo ID
            if (error) throw error;
        } catch (error) {
            console.error("Lỗi khi cập nhật bài làm:", error);
        }

        lastSubmissionData = { examTitle: currentTakingExam.title, questions: currentTakingExam.questions, studentAnswers: studentAnswers, finalScore: totalScore };
        
        const settings = currentTakingExam.settings || { showScore: 'immediately', allowReview: 'immediately' };

        if (settings.showScore === 'immediately') {
            document.getElementById('final-score').textContent = totalScore;
            const reviewButton = document.querySelector('#result-view button[onclick="showReview()"]');
            reviewButton.style.display = settings.allowReview === 'immediately' ? 'block' : 'none';
            showView('result-view');
        } else {
            showView('submission-complete-view');
        }
    }

    // Các hàm tiện ích (showModal, hideModal, toggleRadio, handleBeforeUnload) giữ nguyên
    function showModal(title, message, onConfirm) {
        document.getElementById('modal-title').textContent = title;
        const msgEl = document.getElementById('modal-message');
        msgEl.innerHTML = message;
        modalConfirmCallback = onConfirm;
        const modal = document.getElementById('confirmation-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }


    function hideModal() {
        const modal = document.getElementById('confirmation-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    function toggleRadio(element) {
        const wasChecked = element.getAttribute('data-was-checked') === 'true';
        document.querySelectorAll(`input[name="${element.name}"]`).forEach(el => el.setAttribute('data-was-checked', 'false'));
        if (wasChecked) { element.checked = false; }
        else { element.checked = true; element.setAttribute('data-was-checked', 'true'); }
        if (element.name.startsWith('student_answer')) { saveStudentAnswer(); }
    }

    function handleBeforeUnload(event) { event.preventDefault(); event.returnValue = ''; }

    function showReview() {
        if (!lastSubmissionData) { alert("Không có dữ liệu bài làm để xem lại."); return; }
        document.getElementById('review-exam-title').textContent = lastSubmissionData.examTitle;
        document.getElementById('review-final-score').textContent = `Điểm của bạn: ${lastSubmissionData.finalScore}`;
        renderReview();
        showView('student-review-view');
    }

    function renderReview() {
        const container = document.getElementById('review-questions-container');
        container.innerHTML = '';
        const { questions, studentAnswers } = lastSubmissionData;
        questions.forEach((q, index) => {
            const studentAns = studentAnswers[index];
            const correctAns = q.correct_answer;
            let optionsDisplayHtml = '';
            if (q.question_type === 'multiple_choice') {
                optionsDisplayHtml = q.options.map(({ key, value }) => {
                    const studentChoice = studentAns;
                    const correctChoice = correctAns.answer;
                    let indicator = '';
                    let classes = 'p-3 my-2 rounded-lg border flex items-center gap-3 transition-all ';
                    if (key === correctChoice) {
                        classes += 'bg-green-100 border-green-400 text-green-800 font-semibold';
                        indicator = '<span class="text-green-600 font-bold text-lg">✓</span>';
                    } else if (key === studentChoice) {
                        classes += 'bg-red-100 border-red-400 text-red-800';
                        indicator = '<span class="text-red-500 font-bold text-lg">✗</span>';
                    } else {
                        classes += 'bg-slate-50 border-slate-200';
                    }
                    return `<div class="${classes}"> ${indicator} <div class="math-container font-times">${key}. ${value}</div> </div>`;
                }).join('');
            } 
            else if (q.question_type === 'true_false') {
                optionsDisplayHtml = '<div class="space-y-2 mt-3">';
                optionsDisplayHtml += q.options.map(({ key, value }) => {
                    const studentChoice = studentAns ? studentAns[key] : null;
                    const correctChoice = correctAns ? correctAns[key] : null;
                    const renderTfOption = (optionText) => {
                        let classes = 'py-2 px-5 text-sm font-medium rounded-full border flex items-center gap-1.5 ';
                        let content = optionText;
                        if (optionText === correctChoice) {
                            classes += 'bg-green-600 text-white border-green-700';
                            content = `✓ ${optionText}`;
                        } else if (optionText === studentChoice) {
                            classes += 'bg-red-600 text-white border-red-700';
                            content = `✗ ${optionText}`;
                        } else {
                            classes += 'bg-slate-200 text-slate-500 border-slate-300';
                        }
                        return `<span class="${classes}">${content}</span>`;
                    };
                    return `<div class="flex items-center justify-between my-1 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200"><div class="math-container text-slate-700 mr-4">${key}) ${value}</div><div class="flex items-center gap-x-2">${renderTfOption('Đúng')} ${renderTfOption('Sai')}</div></div>`;
                }).join('');
                optionsDisplayHtml += '</div>';
            }
            else if (q.question_type === 'short_answer') {
                 const isCorrect = String(studentAns || '').toLowerCase() === String(correctAns.answer || '').toLowerCase();
                 let studentAnswerDisplay = studentAns 
                    ? `<p class="mt-2"><b>Câu trả lời của bạn:</b> <span class="font-mono p-2 rounded-md ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${studentAns}</span></p>`
                    : '<p class="text-sm text-slate-500 mt-2"><i>Bạn không trả lời câu này.</i></p>';
                 let correctAnswerDisplay = !isCorrect
                    ? `<p class="mt-2"><b>Đáp án đúng:</b> <span class="font-mono p-2 rounded-md bg-green-100 text-green-800">${correctAns.answer || 'N/A'}</span></p>`
                    : '';
                optionsDisplayHtml = studentAnswerDisplay + correctAnswerDisplay;
            }
            const reviewDiv = document.createElement('div');
            reviewDiv.className = `border-t border-slate-200 pt-6`;
            reviewDiv.innerHTML = `<div class="text-slate-800 math-container mb-4 font-times"><span class="font-bold">Câu ${index + 1}:</span> ${q.content}</div><div>${optionsDisplayHtml}</div>`;
            container.appendChild(reviewDiv);
        });
        setTimeout(() => MathJax.typesetPromise(), 100);
    }

    // *** VIẾT LẠI HÀM XEM LẠI BÀI LÀM CŨ ***
    async function viewOldReview(submissionId) {
        try {
            // 1. Lấy thông tin bài làm từ bảng 'submissions'
            const { data: submissionData, error: subError } = await supabase
                .from('submissions')
                .select('*')
                .eq('id', submissionId)
                .single();
            if (subError || !submissionData) throw subError || new Error("Không tìm thấy bài làm.");

            const examId = submissionData.exam_id;

            // 2. Lấy thông tin đề thi từ bảng 'exams'
            const { data: examData, error: examError } = await supabase
                .from('exams')
                .select('title') // Chỉ cần lấy title
                .eq('id', examId)
                .single();
            if (examError || !examData) throw examError || new Error("Không tìm thấy đề thi tương ứng.");

            // 3. Lấy danh sách câu hỏi từ bảng 'questions'
            const { data: questions, error: questionsError } = await supabase
                .from('questions')
                .select('*')
                .eq('exam_id', examId)
                .order('order', { ascending: true });
            if (questionsError) throw questionsError;

            // Chuẩn bị dữ liệu và hiển thị (giống code cũ)
            lastSubmissionData = {
                examTitle: examData.title,
                questions: questions || [],
                studentAnswers: submissionData.answers,
                finalScore: submissionData.score
            };
            showReview();
        } catch (error) {
            console.error("Lỗi khi xem lại bài làm:", error);
            alert("Không thể tải bài làm để xem lại: " + error.message);
        }
    }

    // --- EXPOSE FUNCTIONS TO GLOBAL SCOPE ---
    // (Đảm bảo tất cả các hàm cần gọi từ HTML đều được đưa vào window)
    window.showView = showView;
    window.checkTeacherPassword = checkTeacherPassword;
    window.handleRegister = handleRegister;
    window.handleLogin = handleLogin;
    window.handleLogout = handleLogout;
    window.handlePasswordReset = handlePasswordReset;
    window.showStudentPortal = showStudentPortal;
    window.loadExamsForTeacher = loadExamsForTeacher;
    window.handleFileSelect = handleFileSelect;
    // window.parseHtmlToQuestions = parseHtmlToQuestions; // Hàm nội bộ, không cần expose
    // window.renderQuestionEditor = renderQuestionEditor; // Hàm nội bộ
    window.saveExam = saveExam;
    window.editExam = editExam;
    window.confirmDeleteExam = confirmDeleteExam;
    window.toggleExamStatus = toggleExamStatus;
    window.viewResults = viewResults;
    window.confirmDeleteSubmission = confirmDeleteSubmission;
    window.deleteSubmission = deleteSubmission;
    window.insertImage = insertImage;
    window.triggerImageUpload = triggerImageUpload;
    window.startExam = startExam; // Hàm nội bộ, gọi qua startExamWrapper
    window.startExamWrapper = startExamWrapper;
    // window.renderQuestionPalette = renderQuestionPalette; // Hàm nội bộ
    window.jumpToQuestion = jumpToQuestion;
    // window.renderCurrentQuestion = renderCurrentQuestion; // Hàm nội bộ
    window.saveStudentAnswer = saveStudentAnswer; // Cần expose vì gọi từ oninput
    window.navigateQuestion = navigateQuestion;
    // window.updateNavigationButtons = updateNavigationButtons; // Hàm nội bộ
    // window.startTimer = startTimer; // Hàm nội bộ
    window.confirmSubmitExam = confirmSubmitExam;
    window.submitExam = submitExam; // Có thể gọi nội bộ từ timer
    window.showModal = showModal; // Cần expose nếu gọi từ HTML (thường không)
    window.hideModal = hideModal; // Cần expose nếu gọi từ HTML (thường không)
    window.toggleRadio = toggleRadio; // Cần expose vì gọi từ onclick
    // window.handleBeforeUnload = handleBeforeUnload; // Tự động gắn/gỡ event listener
    window.showReview = showReview;
    // window.renderReview = renderReview; // Hàm nội bộ
    window.viewOldReview = viewOldReview;
});